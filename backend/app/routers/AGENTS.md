# Vector comparisons

Pass numeric lists or arrays directly to pgvector's SQLAlchemy distance
methods. Do not stringify embeddings: the VECTOR bind processor serializes
them and rejects strings, causing recommendations to return HTTP 500.
