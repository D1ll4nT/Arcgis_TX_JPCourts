DROP TABLE IF EXISTS street_segments;
CREATE TABLE street_segments (
  street_key TEXT    NOT NULL,
  zip        TEXT,
  from_addr  INTEGER NOT NULL,
  to_addr    INTEGER NOT NULL,
  parity     TEXT    NOT NULL,
  lon1 REAL NOT NULL, lat1 REAL NOT NULL,
  lon2 REAL NOT NULL, lat2 REAL NOT NULL
);
