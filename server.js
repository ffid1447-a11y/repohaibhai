require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const { spawn } = require('child_process');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "nic@impds#dedup05613";

// Session management
let currentSession = null;

// Helper functions
function encrypt(text) {
    return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

function parseResults(html) {
    try {
        const $ = cheerio.load(html);
        const tables = $('table.table-striped.table-bordered.table-hover');
        
        if (tables.length < 2) {
            return { error: 'No data found' };
        }
        
        const rationCardMap = {};
        
        // Parse main table
        tables.first().find('tbody tr').each((i, row) => {
            const tds = $(row).find('td');
            if (tds.length >= 8) {
                const rationCardNo = $(tds[3]).text().trim();
                
                if (!rationCardMap[rationCardNo]) {
                    rationCardMap[rationCardNo] = {
                        ration_card_details: {
                            state_name: $(tds[1]).text().trim(),
                            district_name: $(tds[2]).text().trim(),
                            ration_card_no: rationCardNo,
                            scheme_name: $(tds[4]).text().trim()
                        },
                        members: []
                    };
                }
                
                rationCardMap[rationCardNo].members.push({
                    s_no: parseInt($(tds[0]).text().trim()) || 0,
                    member_id: $(tds[5]).text().trim(),
                    member_name: $(tds[6]).text().trim(),
                    remark: $(tds[7]).text().trim() || null
                });
            }
        });
        
        // Parse additional info
        if (tables.length > 1) {
            const infoTable = tables.eq(1);
            Object.values(rationCardMap).forEach(card => {
                const $info = cheerio.load(infoTable.html());
                card.additional_info = {
                    fps_category: "Unknown",
                    impds_transaction_allowed: false,
                    exists_in_central_repository: false,
                    duplicate_aadhaar_beneficiary: false
                };
                
                infoTable.find('tbody tr').each((i, row) => {
                    const tds = $(row).find('td');
                    if (tds.length >= 2) {
                        const label = $(tds[0]).text().trim().toLowerCase();
                        const value = $(tds[1]).text().trim().toLowerCase();
                        
                        if (label.includes('fps category')) {
                            card.additional_info.fps_category = value === 'yes' ? 'Online FPS' : 'Offline FPS';
                        } else if (label.includes('transaction')) {
                            card.additional_info.impds_transaction_allowed = value === 'yes';
                        } else if (label.includes('central')) {
                            card.additional_info.exists_in_central_repository = value === 'yes';
                        } else if (label.includes('duplicate')) {
                            card.additional_info.duplicate_aadhaar_beneficiary = value === 'yes';
                        }
                    }
                });
            });
        }
        
        return Object.values(rationCardMap);
    } catch (error) {
        console.error('Parse error:', error);
        return { error: 'Failed to parse results' };
    }
}

async function getSession() {
    if (currentSession) return currentSession;
    
    console.log('🔄 Getting new session from IMPDS...');
    
    return new Promise((resolve, reject) => {
        const python = spawn('python3', ['impds_auth.py']);
        
        let output = '';
        python.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        python.stderr.on('data', (data) => {
            console.error('Python error:', data.toString());
        });
        
        python.on('close', (code) => {
            if (code === 0) {
                const match = output.match(/JSESSIONID:\s*([A-F0-9]{32})/);
                if (match) {
                    currentSession = match[1];
                    console.log('✅ Session obtained');
                    resolve(currentSession);
                } else {
                    reject(new Error('JSESSIONID not found'));
                }
            } else {
                reject(new Error(`Python script failed with code ${code}`));
            }
        });
        
        // Timeout after 30 seconds
        setTimeout(() => {
            python.kill();
            reject(new Error('Python script timeout'));
        }, 30000);
    });
}

// API Endpoints
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'IMPDS API',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

app.get('/search', async (req, res) => {
    try {
        const { aadhaar, type = 'A' } = req.query;
        
        if (!aadhaar) {
            return res.status(400).json({
                success: false,
                error: 'Aadhaar number is required'
            });
        }
        
        // Validate Aadhaar
        const cleanAadhaar = aadhaar.replace(/\s/g, '');
        if (!/^\d{12}$/.test(cleanAadhaar)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Aadhaar number. Must be 12 digits.'
            });
        }
        
        console.log(`🔍 Searching Aadhaar: ${cleanAadhaar.substring(0, 8)}...`);
        
        // Get session
        const sessionId = await getSession();
        
        // Encrypt Aadhaar
        const encryptedAadhaar = encrypt(cleanAadhaar);
        
        // Make request to IMPDS
        const response = await axios.post(
            'https://impds.nic.in/impdsdeduplication/search',
            `search=${type}&aadhar=${encodeURIComponent(encryptedAadhaar)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': `JSESSIONID=${sessionId}`,
                    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
                    'Referer': 'https://impds.nic.in/impdsdeduplication/search'
                },
                timeout: 30000
            }
        );
        
        // Parse results
        const results = parseResults(response.data);
        
        if (results.error) {
            return res.status(404).json({
                success: false,
                error: results.error
            });
        }
        
        res.json({
            success: true,
            count: results.length,
            results: results
        });
        
    } catch (error) {
        console.error('Search error:', error.message);
        
        // Reset session on failure
        if (error.response?.status === 500 || error.message.includes('session')) {
            currentSession = null;
        }
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/encrypt', (req, res) => {
    const { text } = req.query;
    
    if (!text) {
        return res.status(400).json({
            success: false,
            error: 'Text is required'
        });
    }
    
    try {
        const encrypted = encrypt(text);
        res.json({
            success: true,
            original: text,
            encrypted: encrypted
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/', (req, res) => {
    res.json({
        service: 'IMPDS Aadhaar Search API',
        version: '1.0.0',
        endpoints: {
            search: 'GET /search?aadhaar=123456789012',
            encrypt: 'GET /encrypt?text=your_text',
            health: 'GET /health'
        }
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 IMPDS API running on port ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
});
