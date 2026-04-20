FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Force Playwright to use system-installed browsers (IMPORTANT)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package*.json ./

# Install dependencies + browsers in correct order
RUN npm install

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
