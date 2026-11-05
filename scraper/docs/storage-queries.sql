-- KAN-605: Postgres storage baseline queries.
-- Run against Supabase (the scraper never touches the DB).

-- 1. job_postings: total size, table, index, TOAST
SELECT
    pg_size_pretty(pg_total_relation_size('job_postings'))   AS total,
    pg_size_pretty(pg_relation_size('job_postings'))         AS table_size,
    pg_size_pretty(pg_indexes_size('job_postings'))          AS index_size,
    pg_size_pretty(
        pg_total_relation_size('job_postings')
        - pg_relation_size('job_postings')
        - pg_indexes_size('job_postings')
    ) AS toast_size;

-- 2. Per-column approximate sizes (description, embedding, fts, keywords, other)
SELECT
    'description'       AS col,
    pg_size_pretty(sum(pg_column_size(description))) AS size
FROM job_postings
UNION ALL
SELECT
    'embedding',
    pg_size_pretty(sum(pg_column_size(embedding)))
FROM job_postings
UNION ALL
SELECT
    'fts',
    pg_size_pretty(sum(pg_column_size(fts)))
FROM job_postings
UNION ALL
SELECT
    'keywords',
    pg_size_pretty(sum(pg_column_size(keywords)))
FROM job_postings
UNION ALL
SELECT
    'other',
    pg_size_pretty(
        pg_relation_size('job_postings')
        - coalesce(sum(pg_column_size(description)), 0)
        - coalesce(sum(pg_column_size(embedding)), 0)
        - coalesce(sum(pg_column_size(fts)), 0)
        - coalesce(sum(pg_column_size(keywords)), 0)
    )
FROM job_postings;

-- 3. Row count by status
SELECT status, count(*) AS rows
FROM job_postings
GROUP BY status
ORDER BY rows DESC;

-- 4. Average and percentile description lengths
SELECT
    count(*)                                           AS total,
    count(description)                                 AS with_desc,
    round(avg(length(description)))                    AS avg_chars,
    round(avg(octet_length(description)))              AS avg_bytes,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY octet_length(description)) AS p50_bytes,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY octet_length(description)) AS p95_bytes,
    max(octet_length(description))                     AS max_bytes
FROM job_postings
WHERE description IS NOT NULL;

-- 5. job_locations table size
SELECT
    pg_size_pretty(pg_total_relation_size('job_locations')) AS total,
    pg_size_pretty(pg_relation_size('job_locations'))       AS table_size,
    pg_size_pretty(pg_indexes_size('job_locations'))        AS index_size;
