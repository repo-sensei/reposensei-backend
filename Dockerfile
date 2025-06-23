FROM node:18-alpine

WORKDIR /usr/src/app

# Install Git (required for repository cloning)
RUN apk add --no-cache git

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
