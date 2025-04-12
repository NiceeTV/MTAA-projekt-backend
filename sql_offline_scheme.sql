-- definované typy
CREATE TYPE visibility_level AS ENUM ('public', 'friends', 'private');



-- offline tripy
CREATE TABLE offline_trips (
  offline_trip_id SERIAL PRIMARY KEY,
  trip_title TEXT NOT NULL,
  trip_description TEXT,
  rating DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 5),
  visibility visibility_level NOT NULL DEFAULT 'public',
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sync_status INT DEFAULT 0 -- 0 = not synced, 1 = synced
);



-- offline markery
CREATE TABLE offline_markers (
  offline_marker_id SERIAL PRIMARY KEY,
  offline_trip_id INT NOT NULL,
  x_pos FLOAT NOT NULL,
  y_pos FLOAT NOT NULL,
  marker_title TEXT NOT NULL,
  marker_description TEXT,
  trip_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sync_status INT DEFAULT 0, -- 0 = not synced, 1 = synced
  FOREIGN KEY (offline_trip_id) REFERENCES offline_trips(offline_trip_id) ON DELETE CASCADE
);



-- offline obrázky tripov
CREATE TABLE offline_trip_images (
  offline_trip_image_id SERIAL PRIMARY KEY,
  offline_trip_id INT NOT NULL,
  image_filename TEXT NOT NULL, -- Názov obrázku, napr. 'image_12345.jpg'
  image_path TEXT NOT NULL, -- Relatívna cesta k obrázku v offline priečinku (napr. 'offline_images/user_id/image_12345.jpg')
  sync_status INT DEFAULT 0, -- 0 = not synced, 1 = synced
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (offline_trip_id) REFERENCES offline_trips(offline_trip_id) ON DELETE CASCADE
);