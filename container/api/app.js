const express = require('express')
const app = express()
const port = 3000
const mysql = require('mysql')

const connection = mysql.createConnection({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
})

connection.connect(function(err) {
    if (err) throw err

    connection.query('CREATE DATABASE IF NOT EXISTS main;')
    connection.query('USE main;')
    connection.query("CREATE TABLE IF NOT EXISTS users(id int NOT NULL AUTO_INCREMENT, username varchar(30), email varchar(255), age int, PRIMARY KEY(id));", function(error, result, fields) {
        console.log(result)
    })
    connection.query(`INSERT INTO main.users (username, email, age)
                      VALUES ('admin', 'admin@gmail.com', '18')`, function(err, result, fields) {
        console.log(result)
    })
    connection.end()
})

app.get('/api/health', (req, res) => {
    res.send('API is healthy')
})

app.post('/request-backend', (req, res) => {
    res.send('ok')
})

app.post('/request-database', (req, res) => {
    connection.connect(function(err) {
        if (err) throw err
        connection.query(`SELECT *
                          FROM main.users`, function(err, result, fields) {
            res.send('ok')
        })
    })
})

app.listen(port, () => {
    console.log(`API running on port ${port}`)
})
