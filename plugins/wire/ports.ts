/** What common ports and macOS background services are for. Plain data, used by the server and the screens. */

export interface PortInfo {
  name: string;
  about: string;
  /** A short-lived port the system picked; it has no fixed meaning. */
  temporary?: true;
}

const PORTS: Record<number, PortInfo> = {
  22: { name: "SSH", about: "Secure Shell: an encrypted remote terminal and file copy." },
  25: { name: "SMTP", about: "Sends mail between mail servers." },
  53: { name: "DNS", about: "Turns names like example.com into addresses." },
  80: { name: "HTTP", about: "Web traffic without encryption." },
  88: { name: "Kerberos", about: "Sign-in tickets for a company or school network." },
  123: { name: "NTP", about: "Keeps your clock correct." },
  143: { name: "IMAP", about: "Reads mail from a mail server." },
  389: { name: "LDAP", about: "Directory lookups, often a company address book." },
  443: { name: "HTTPS", about: "Encrypted web traffic. Most apps and sites use it." },
  445: { name: "SMB", about: "Windows-style file sharing." },
  465: { name: "SMTPS", about: "Sends mail over an encrypted connection." },
  548: { name: "AFP", about: "Apple file sharing, the older kind." },
  587: { name: "SMTP", about: "Your mail app hands outgoing mail to your provider." },
  631: { name: "Printing", about: "Printing through CUPS. Other computers can print through this Mac when printer sharing is on." },
  636: { name: "LDAPS", about: "Directory lookups over an encrypted connection." },
  853: { name: "DNS over TLS", about: "Encrypted name lookups." },
  993: { name: "IMAP", about: "Reads mail from a mail server over an encrypted connection." },
  995: { name: "POP3", about: "Downloads mail from a mail server over an encrypted connection." },
  1883: { name: "MQTT", about: "Messages between smart-home devices and a hub." },
  1900: { name: "SSDP", about: "Devices announce themselves on your network (UPnP)." },
  3306: { name: "MySQL", about: "A MySQL database server." },
  3389: { name: "Remote Desktop", about: "Windows Remote Desktop." },
  3478: { name: "STUN", about: "Helps video-call apps find a direct path between two people." },
  3689: { name: "Music sharing", about: "Shares a Music library with other computers on your network." },
  5000: { name: "AirPlay Receiver", about: "Lets other Apple devices send audio and video to this Mac." },
  5060: { name: "SIP", about: "Starts voice-over-IP calls." },
  5223: { name: "Apple push", about: "Apple Push Notification service: one open connection so messages arrive instantly." },
  5228: { name: "Google push", about: "Google's push service, which wakes apps when a message arrives." },
  5353: { name: "Bonjour", about: "Finds printers, speakers and other devices on your network by name." },
  5432: { name: "PostgreSQL", about: "A PostgreSQL database server." },
  5900: { name: "Screen Sharing", about: "Lets someone see and control this screen (VNC)." },
  6379: { name: "Redis", about: "A Redis database server." },
  7000: { name: "AirPlay Receiver", about: "Lets other Apple devices send audio and video to this Mac." },
  8080: { name: "HTTP (alternate)", about: "A common port for web servers and development servers." },
  8443: { name: "HTTPS (alternate)", about: "A common alternative port for encrypted web servers." },
  8883: { name: "MQTT over TLS", about: "Encrypted messages between smart-home devices and a hub." },
  9100: { name: "Printer", about: "Sends a print job straight to a network printer." },
  27017: { name: "MongoDB", about: "A MongoDB database server." },
};

const TEMPORARY: PortInfo = { name: "Temporary port", about: "A temporary port chosen by the system or the app. It has no fixed meaning.", temporary: true };

export function portInfo(port: number): PortInfo | null {
  const known = PORTS[port];
  if (known) return known;
  return port >= 49_152 ? TEMPORARY : null;
}

/** Background services on macOS whose names say little. */
const PROCESS_ABOUT: Record<string, string> = {
  rapportd: "Handoff, Universal Clipboard and other links between your Apple devices.",
  sharingd: "AirDrop, Handoff and file sharing.",
  identityservicesd: "iMessage and FaceTime.",
  apsd: "Apple push notifications.",
  nsurlsessiond: "Background downloads and uploads for apps.",
  cloudd: "iCloud sync.",
  trustd: "Checks that website certificates are still valid.",
  mDNSResponder: "Bonjour: finds devices on your network by name.",
  ControlCenter: "The menu bar controls, including the AirPlay Receiver.",
};

export function processAbout(name: string): string | null {
  return PROCESS_ABOUT[name] ?? null;
}
