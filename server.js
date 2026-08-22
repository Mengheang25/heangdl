const express = require("express");
const cors = require("cors");
const path = require("path");
const proxyRouter = require("./proxy");

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Body parser configuration for JSON & form payloads up to 50MB
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Mount Proxy Endpoints
app.use("/api", proxyRouter);
app.use(proxyRouter); // Fallback so /proxy and /api/proxy both work

// Serve static frontend web application files from 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Fallback SPA routing to index.html for all other non-API requests
app.use((req, res) => {
  if (req.method === "GET" && !req.path.startsWith("/api") && !req.path.startsWith("/proxy")) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }
  res.status(404).json({ error: "Endpoint not found" });
});

// Start Node.js Express Web App & Proxy Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 HEANG D.L Web App & Proxy Server is running!`);
  console.log(`🌐 Local Web App URL: http://localhost:${PORT}`);
  console.log(`🔗 API & Proxy Base: http://localhost:${PORT}/api/proxy`);
  console.log(`==================================================`);
});

module.exports = app;
