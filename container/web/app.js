const express = require('express')
const app = express()
const path = require('path')
const port = 80

const filePath = path.resolve(__dirname, 'index.ejs')

app.set('view engine', 'ejs')
app.set('views', __dirname + '/views')

const apiUrl = process.env.API_URL || 'http://localhost:3000'

app.get('/web/health', (req, res) => {
    res.send('Web is healthy')
})

app.get('/home', (req, res) => {
    res.render('index', { apiUrl: apiUrl })
})

app.listen(port, () => {
    console.log(`Web running on port ${port}`)
})


