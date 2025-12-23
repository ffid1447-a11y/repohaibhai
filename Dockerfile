FROM node:18-slim

# Install system dependencies for Python and Tesseract
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    tesseract-ocr \
    libtesseract-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install Node.js dependencies
COPY package*.json ./
RUN npm install --production

# Copy Python requirements and install
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port and define startup command
EXPOSE 3000
CMD ["node", "server.js"]
