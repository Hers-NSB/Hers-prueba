"""Prepare an additive D1 import from verified SQL exports without contacting Cloudflare."""

import argparse
import json
import os
import sqlite3
from pathlib import Path

ARCHIVE = """CREATE TABLE IF NOT EXISTS dropper_migration_archive (
  source TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (source, table_name, record_key)
);"""

PUBLICATIONS = ("creator_id", "creator_name", "drop_id", "position", "post_id", "manual", "confirmed_at", "local_date")


def load(path):
    db = sqlite3.connect(":memory:")
    db.row_factory = sqlite3.Row
    db.executescript(path.read_text(encoding="utf-8"))
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ValueError(f"Respaldo inválido: {path.name}")
    return db


def table_rows(db, table):
    exists = db.execute("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?", (table,)).fetchone()
    return db.execute(f"SELECT * FROM {table}").fetchall() if exists else []


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        if "\x00" in value:
            return "CAST(X'" + value.encode("utf-8").hex() + "' AS TEXT)"
        return "'" + value.replace("'", "''") + "'"
    raise TypeError(f"Tipo inesperado en el respaldo: {type(value).__name__}")


def values(*items):
    return "(" + ", ".join(map(literal, items)) + ")"


def archive(lines, source, table, key, row):
    lines.append("INSERT INTO dropper_migration_archive (source, table_name, record_key, payload) VALUES "
                 + values(source, table, key, json.dumps(dict(row), ensure_ascii=False, sort_keys=True))
                 + " ON CONFLICT DO NOTHING;")


def publication_key(row):
    return row["creator_id"], row["post_id"]


def position_key(row):
    return row["creator_id"], row["drop_id"], row["position"]


def prepare(destination, sources):
    lines = [ARCHIVE]
    profiles = {(row["bot_id"], row["creator_id"]) for row in table_rows(destination, "profiles")}
    posts = {publication_key(row): row for row in table_rows(destination, "drop_publications")}
    positions = {position_key(row): row["post_id"] for row in posts.values()}
    counts = {"before": len(posts), "new": 0, "duplicates": 0, "archived": 0}

    for source, db in sources:
        for row in table_rows(db, "profiles"):
            if (row["bot_id"], row["creator_id"]) not in profiles:
                raise ValueError(f"Hay un perfil de {source} sin equivalencia activa. Revísalo antes de importar.")
            archive(lines, source, "profiles", row["id"], row)
            counts["archived"] += 1

        for row in table_rows(db, "settings"):
            archive(lines, source, "settings", row["key"], row)
            counts["archived"] += 1

        for row in table_rows(db, "login_attempts"):
            archive(lines, source, "login_attempts", row["id"], row)
            counts["archived"] += 1

        for row in table_rows(db, "drop_publications"):
            post = publication_key(row)
            position = position_key(row)
            if post in posts:
                counts["duplicates"] += 1
                if dict(posts[post]) != dict(row):
                    archive(lines, source, "drop_publications", f"{post[0]}/{post[1]}", row)
                    counts["archived"] += 1
                continue
            if position in positions:
                raise ValueError(f"Hay una posición de drop en conflicto en {source}. Revísala antes de importar.")
            sql = "INSERT INTO drop_publications (" + ", ".join(PUBLICATIONS) + ") VALUES "
            lines.append(sql + values(*(row[column] for column in PUBLICATIONS))
                         + " ON CONFLICT (creator_id, post_id) DO NOTHING;")
            counts["new"] += 1
            posts[post] = row
            positions[position] = row["post_id"]

    counts["after"] = len(posts)
    script = "\n".join(lines) + "\n"
    destination.executescript(script)
    if destination.execute("SELECT count(*) FROM drop_publications").fetchone()[0] != counts["after"]:
        raise ValueError("El ensayo de importación no reprodujo el total esperado")
    return script, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if len({path.stem for path in args.sources}) != len(args.sources):
        parser.error("Los respaldos de origen deben tener nombres distintos")
    script, counts = prepare(load(args.destination), [(path.stem, load(path)) for path in args.sources])
    with open(args.output, "x", encoding="utf-8", opener=private_file) as output:
        output.write(script)
    print(json.dumps(counts))


def private_file(path, flags):
    return os.open(path, flags, 0o600)


if __name__ == "__main__":
    main()
