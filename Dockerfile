# =====================================================================
# STAGE 1: Build Phase (Heavier, used to install dependencies)
# =====================================================================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# This copy dependency configuration files first to exploit layer caching
COPY package*.json ./

# Install packages (using a clean installer format)
RUN npm ci

# Copy your source application code over
COPY src/ ./src


# =====================================================================
# STAGE 2: Production Runtime Phase (Ultra-lightweight and secure)
# =====================================================================
FROM node:20-alpine AS runtime

# Set environmental variable to optimize dependencies
ENV NODE_ENV=production

WORKDIR /app

# Pull only the necessary codebase from Stage 1
COPY --from=builder /usr/src/app/src ./src

# Expose our node traffic port matching our src/app.js file
EXPOSE 3000

# Start up our application engine
CMD ["node", "src/app.js"]
