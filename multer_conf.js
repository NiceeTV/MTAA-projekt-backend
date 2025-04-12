const multer = require('multer');
const path = require('path');
const fs = require('fs');

//setup ukládania obrázkov
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const { user_id, trip_id } = req.params;  // Získame user_id a trip_id z parametrov URL

        // Kontrola prítomnosti user_id a trip_id
        if (!user_id || !trip_id) {
            return cb(new Error('user_id alebo trip_id chýbajú v parametroch URL'), null);
        }

        // Cesta k adresáru, kde budú uložené obrázky
        const dir = path.join(__dirname, 'images', user_id, trip_id);

        // Asynchrónne vytváranie adresára
        fs.mkdir(dir, { recursive: true }, (err) => {
            if (err) {
                console.error('Chyba pri vytváraní adresára:', err);
                return cb(err, null);  // Ak sa vyskytne chyba pri vytváraní adresára
            }
            cb(null, dir);  // Po úspešnom vytvorení adresára nastavíme destináciu
        });
    },
    filename: function (req, file, cb) {
        // Vytvoríme unikátny názov pre súbor
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);  // Nastavíme unikátny názov pre obrázok
    }
});

//inicializácia multer
const upload = multer({ storage });

module.exports = upload;