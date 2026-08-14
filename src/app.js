const http = require('http');
const PORT = process.env.PORT || 3000;
const ENV_NAME = process.env.NODE_ENV || 'Staging Environment';

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'UP', environment: ENV_NAME }));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Welcome to the ${ENV_NAME}!\nDeployment is 100% SUCCESSFUL!\nThis is our Staging Dress Rehearsal!\n`);
});

server.listen(PORT, () => {
  console.log(`Server running securely on port ${PORT}`);
});
