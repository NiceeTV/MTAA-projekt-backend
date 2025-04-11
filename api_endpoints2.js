module.exports = (app, pool) => {
    app.get('/', (req, res) => {
        res.send('API beží správne 🚀');
    });

}