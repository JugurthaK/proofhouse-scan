const express = require("express");
const sqlite3 = require("sqlite3");

const app = express();
const db = new sqlite3.Database("app.db");

// Planted SQL injection: user input concatenated into the query (true positive)
app.get("/users/:id", (req, res) => {
  db.get("SELECT * FROM users WHERE id = " + req.params.id, (err, row) => {
    res.json(row);
  });
});

// Planted XSS: unescaped user input reflected into HTML (true positive)
app.get("/hello", (req, res) => {
  res.send("<h1>Hello " + req.query.name + "</h1>");
});

app.listen(3000);
