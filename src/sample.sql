CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE order_status AS ENUM ('cart', 'paid', 'shipped', 'delivered', 'refunded');
CREATE TYPE book_format AS ENUM ('hardcover', 'paperback', 'ebook', 'audio');

-- A lookup table almost everything points at: drawn as lines it would cross the whole map,
-- so with Portals on (5+ references) each reference becomes a chip wearing the table's mark.
CREATE TABLE countries (
  code  char(2) PRIMARY KEY,
  name  text NOT NULL UNIQUE
);
COMMENT ON TABLE countries IS 'ISO 3166-1 alpha-2. Referenced from five tables: a portal hub in the Atlas view.';

CREATE TABLE authors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  bio        text,
  born_on    date,
  nationality char(2) REFERENCES countries (code)
);

CREATE TABLE publishers (
  id      smallserial PRIMARY KEY,
  name    text NOT NULL UNIQUE,
  country char(2) NOT NULL REFERENCES countries (code)
);

CREATE TABLE categories (
  id    smallserial PRIMARY KEY,
  name  text NOT NULL,
  path  ltree NOT NULL UNIQUE
);
COMMENT ON COLUMN categories.path IS 'Materialised path, e.g. fiction.fantasy.epic';
CREATE INDEX idx_categories_path ON categories USING gist (path);

CREATE TABLE books (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  isbn          char(13) NOT NULL UNIQUE,
  title         text NOT NULL,
  format        book_format NOT NULL DEFAULT 'paperback',
  price         numeric(10, 2) NOT NULL CHECK (price >= 0),
  publisher_id  smallint REFERENCES publishers (id),
  published_on  date,
  origin_country char(2) REFERENCES countries (code),
  embedding     vector(768)
);
COMMENT ON TABLE books IS 'One row per edition: the same work in two formats is two books.';
COMMENT ON COLUMN books.origin_country IS 'Where the work was first published (shelves translated fiction by origin).';
CREATE INDEX idx_books_embedding ON books USING hnsw (embedding vector_cosine_ops);

CREATE TABLE book_authors (
  book_id   bigint NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  author_id bigint NOT NULL REFERENCES authors (id),
  position  smallint NOT NULL DEFAULT 1,
  PRIMARY KEY (book_id, author_id)
);

CREATE TABLE book_categories (
  book_id     bigint NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  category_id smallint NOT NULL REFERENCES categories (id),
  PRIMARY KEY (book_id, category_id)
);

CREATE TABLE customers (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      citext NOT NULL UNIQUE,
  full_name  text NOT NULL,
  country    char(2) REFERENCES countries (code),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers (id),
  status      order_status NOT NULL DEFAULT 'cart',
  placed_at   timestamptz,
  total       numeric(12, 2),
  ship_to     char(2) REFERENCES countries (code)
);
CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_open ON orders (placed_at) WHERE status IN ('paid', 'shipped');

CREATE TABLE order_items (
  order_id  bigint NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  book_id   bigint NOT NULL REFERENCES books (id),
  quantity  integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(10, 2) NOT NULL,
  PRIMARY KEY (order_id, book_id)
);

CREATE TABLE reviews (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  book_id     bigint NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  customer_id integer REFERENCES customers (id) ON DELETE SET NULL,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
