import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders

class MailService:
    """Handles sending email notifications."""
    
    def __init__(self):
        self.smtp_server = "smtp-relay.brevo.com"
        self.smtp_port = 587
        self.smtp_login = "998d28001@smtp-brevo.com"
        self.sender_email = "khaledkherallah204@gmail.com"
        self.sender_password = "xsmtpsib-04ecd46969999fed5019b03fa1078b80d3b409b1e200f972c69dbe3b71181c3c-pVqLqf4qJqOabBzK"
    
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