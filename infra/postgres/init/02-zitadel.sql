-- Zitadel keeps its own database (YT-0520). Local development only.
SELECT 'CREATE DATABASE zitadel' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='zitadel')\gexec
