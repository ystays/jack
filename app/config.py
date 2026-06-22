from pathlib import Path
import os

from dotenv import load_dotenv


load_dotenv()


class Settings:
    def __init__(self) -> None:
        self.qobuz_app_id = os.getenv("QOBUZ_APP_ID", "")
        self.qobuz_user_auth_token = os.getenv("QOBUZ_USER_AUTH_TOKEN", "")
        self.streamrip_bin = os.getenv("STREAMRIP_BIN", "rip")
        self.streamrip_config = os.getenv("STREAMRIP_CONFIG", "")
        self.music_dir = Path(os.getenv("MUSIC_DIR", "./music")).resolve()
        self.default_quality = int(os.getenv("DEFAULT_QUALITY", "3"))


settings = Settings()
