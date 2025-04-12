const multer = require('multer');
const path = require('path');
const fs = require('fs');

//setup ukládania obrázkov
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const { user_id, trip_id } = req.params;  // Získame user_id a trip_id z parametrov URL

        let dir;  //cesta k adresáru

        //ak je tam trip_id, tak to uloží ako trip image, ináč ako profilovku
        if (trip_id) {
            dir = path.join(__dirname, 'images', user_id, 'trip_images', trip_id);  // Cesta pre obrázok k tripu
        } else {
            //profilovka
            dir = path.join(__dirname, 'images', user_id, 'profile_images');  // Cesta pre profilový obrázok
        }

        //vytvorenie adresára ak neexistuje
        fs.mkdir(dir, { recursive: true }, (err) => {
            if (err) {
                console.error('Chyba pri vytváraní adresára:', err);
                return cb(err, null);  //error pri vytváraní adresára
            }
            cb(null, dir);  //nastavenie destinácie kde sa to uloží
        });
    },
    filename: function (req, file, cb) {
        //unikátny názov pre súbor
        const uniqueName = Date.now() + '-' + file.originalname;
        cb(null, uniqueName);  // Nastavíme unikátny názov pre obrázok
    }
});

//inicializácia multer
const upload = multer({ storage });

module.exports = upload;