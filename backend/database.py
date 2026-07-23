import os
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
import psycopg2.pool
from dotenv import load_dotenv

load_dotenv()

_DSN = os.environ["DATABASE_URL"]

_pool = psycopg2.pool.ThreadedConnectionPool(minconn=1, maxconn=10, dsn=_DSN)


def _healthy_conn():
    """Get a connection from the pool; replace it if Supabase closed it."""
    conn = _pool.getconn()
    try:
        conn.cursor().execute("SELECT 1")
        conn.rollback()
        return conn
    except Exception:
        # Connection is dead — close it and open a fresh one in its place
        try:
            _pool.putconn(conn, close=True)
        except Exception:
            pass
        return psycopg2.connect(_DSN)


@contextmanager
def get_conn():
    conn = _healthy_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            _pool.putconn(conn)
        except Exception:
            conn.close()


def get_cursor(conn):
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
