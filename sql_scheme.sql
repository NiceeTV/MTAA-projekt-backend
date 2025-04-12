-- definované typy
CREATE TYPE visibility_level AS ENUM ('public', 'friends', 'private');
CREATE TYPE message_type AS ENUM ('trip_share', 'friend_request');
CREATE TYPE friendship_status AS ENUM ('pending', 'accepted', 'blocked');



-- tabuľka používateľov
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL CHECK (email LIKE '%@%.%'),
  bio TEXT,
  password TEXT NOT NULL, -- hešované heslo
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- štatistika používateľa
CREATE TABLE statistics (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  number_of_trips INT DEFAULT 0 CHECK (number_of_trips >= 0),
  total_distance INT DEFAULT 0 CHECK (total_distance >= 0),
  most_visited_place TEXT,
  time_spent_travelling INTERVAL DEFAULT INTERVAL '0'
);



-- záznamy tripov
CREATE TABLE trip (
  trip_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_title TEXT NOT NULL,
  trip_description TEXT,
  rating DECIMAL(3,2) CHECK (rating >= 0 AND rating <= 5),
  visibility visibility_level NOT NULL DEFAULT 'public',
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- viacdnovy trip pozostáva z viacero tripov
CREATE TABLE multi_day_trip (
  multi_day_trip_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- prepájacia tabuľka m:n pre viacdnocy trip a tripy
CREATE TABLE multi_day_trip_trip (
  id SERIAL PRIMARY KEY,
  multi_day_trip_id INT NOT NULL REFERENCES multi_day_trip(multi_day_trip_id) ON DELETE CASCADE,
  trip_id INT NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  trip_order INT -- poradie výletu vo viacdňovom tripe
);



-- markery tripu
CREATE TABLE markers (
  marker_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  x_pos FLOAT NOT NULL,
  y_pos FLOAT NOT NULL,
  marker_title TEXT NOT NULL,
  marker_description TEXT,
  trip_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);



-- prepájacia tabuľka m:n vzťah medzi trip a markers
CREATE TABLE trip_markers (
  trip_id INT NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  marker_id INT NOT NULL REFERENCES markers(marker_id) ON DELETE CASCADE
);



-- systém notifikácií
CREATE TABLE notifications (
  notification_id SERIAL PRIMARY KEY,
  sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  type message_type,
  CHECK (sender_id != target_id)
);



-- kto je s kým alebo chce byť priateľ 
CREATE TABLE friends (
  friendship_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status friendship_status,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (user_id != friend_id),
  UNIQUE (user_id, friend_id)
);



-- obrázky tripov
CREATE TABLE trip_images (
  trip_image_id SERIAL PRIMARY KEY,
  trip_id INT NOT NULL REFERENCES trip(trip_id) ON DELETE CASCADE,
  image_url TEXT NOT NULL
);



-- aktuálne profilové fotky
CREATE TABLE profile_picture (
  picture_id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  UNIQUE(user_id)
);