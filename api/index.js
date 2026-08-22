const express = require("express");
const cors = require("cors");
const proxyRouter = require("../proxy");

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use(proxyRouter);

module.exports = app;
