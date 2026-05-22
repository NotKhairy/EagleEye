import smtplib
import os
import importlib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

# Load workspace root .env so backend runtime and containers share one source of truth.
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _load_root_env():
    try:
        dotenv_module = importlib.import_module("dotenv")
        dotenv_module.load_dotenv(os.path.join(PROJECT_ROOT, ".env"), override=False)
    except ModuleNotFoundError:
        print("[WARNING] python-dotenv not installed. Falling back to process environment variables only")


_load_root_env()

class MailService:
    """Handles sending email notifications."""
    
    def __init__(self):
        self.smtp_server = os.getenv("SMTP_SERVER", "smtp-relay.brevo.com")

        smtp_port_raw = os.getenv("SMTP_PORT", "587")
        try:
            self.smtp_port = int(smtp_port_raw)
        except ValueError:
            self.smtp_port = 587
            print(f"[WARNING] Invalid SMTP_PORT '{smtp_port_raw}'. Falling back to 587")

        self.smtp_login = (os.getenv("SMTP_LOGIN") or "").strip()
        self.sender_email = (os.getenv("SENDER_EMAIL") or "").strip()
        self.sender_password = (os.getenv("SENDER_PASSWORD") or "").strip()

        missing_keys = []
        if not self.smtp_login:
            missing_keys.append("SMTP_LOGIN")
        if not self.sender_email:
            missing_keys.append("SENDER_EMAIL")
        if not self.sender_password:
            missing_keys.append("SENDER_PASSWORD")

        self.email_enabled = len(missing_keys) == 0
        if not self.email_enabled:
            print(
                "[WARNING] Email service disabled. Missing env vars: "
                + ", ".join(missing_keys)
            )
    
    def send_email(self, recipient_email, subject, body, attachments=None):
        """
        Send an email notification with optional attachments.
        
        Args:
            recipient_email (str): The recipient's email address.
            subject (str): The email subject line.
            body (str): The email body content.
            attachments (list, optional): List of file paths to attach. 
                                         Example: ["/path/to/file.pdf", "/path/to/image.png"]
                                         Defaults to None (no attachments).
        
        Returns:
            bool: True if email sent successfully, False otherwise.
        """
        if not self.email_enabled:
            print("[WARNING] Email send skipped: email service is disabled")
            return False

        try:
            # Create a multipart message that can hold both text and attachments
            message = MIMEMultipart()
            message["From"] = self.sender_email
            message["To"] = recipient_email
            message["Subject"] = subject
            
            # Attach the email body as plain text
            message.attach(MIMEText(body, "plain"))
            
            # Attach files if provided
            if attachments:
                for file_path in attachments:
                    if not os.path.exists(file_path):
                        print(f"[WARNING] Attachment file not found: {file_path}")
                        continue
                    
                    try:
                        # Extract filename from path
                        filename = os.path.basename(file_path)
                        
                        # Read and attach the file
                        with open(file_path, "rb") as attachment:
                            part = MIMEBase("application", "octet-stream")
                            part.set_payload(attachment.read())
                        
                        # Encode the file in base64
                        encoders.encode_base64(part)
                        
                        # Add header with filename
                        part.add_header("Content-Disposition", f"attachment; filename= {filename}")
                        message.attach(part)
                        print(f"[INFO] Attached file: {filename}")
                    except Exception as e:
                        print(f"[WARNING] Failed to attach file {file_path}: {e}")
            
            # Send the email
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_login, self.sender_password)
                server.sendmail(self.sender_email, recipient_email, message.as_string())
            
            print(f"[INFO] Email sent to {recipient_email}")
            return True
        except Exception as e:
            print(f"[ERROR] Failed to send email: {e}")
            return False