import hmac

from fastapi import Header, HTTPException, status

from .settings import get_settings


def require_service_auth(authorization: str | None = Header(default=None)) -> None:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing credential")
    scheme, separator, token = authorization.partition(" ")
    expected = get_settings().service_token
    if separator != " " or scheme.lower() != "bearer" or not hmac.compare_digest(token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credential")
