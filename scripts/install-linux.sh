#!/usr/bin/env bash
set -euo pipefail

echo "Migo — Server Install"
echo "====================="
echo

# Must run as root (or with sudo)
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash scripts/install-linux.sh"
  exit 1
fi

# Detect distro
if [ -f /etc/os-release ]; then
  . /etc/os-release
  DISTRO="$ID"
else
  echo "Unsupported OS. Install Docker and Node.js manually, then run: node scripts/setup.mjs"
  exit 1
fi

echo "Detected: $PRETTY_NAME"
echo

# Install git if missing
if ! command -v git &>/dev/null; then
  echo "Installing git..."
  case "$DISTRO" in
    ubuntu|debian) apt-get update -y && apt-get install -y git ;;
    fedora|centos|rhel|rocky|alma) yum install -y git ;;
  esac
  echo "Git installed."
  echo
fi

# Clone repo if not already in it
if [ ! -f "scripts/install-linux.sh" ]; then
  echo "Cloning Migo..."
  git clone https://github.com/eduardoalba00/migo.git /opt/migo
  cd /opt/migo
  echo
fi

# Install Docker if missing
if command -v docker &>/dev/null; then
  echo "Docker already installed: $(docker --version)"
else
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
  echo "Docker installed."
fi
echo

# Install Node.js if missing
if command -v node &>/dev/null; then
  echo "Node.js already installed: $(node --version)"
else
  echo "Installing Node.js 22..."
  case "$DISTRO" in
    ubuntu|debian)
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      apt-get install -y nodejs
      ;;
    fedora|centos|rhel|rocky|alma)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      yum install -y nodejs
      ;;
    *)
      echo "Unsupported distro for auto-install. Install Node.js 22+ manually."
      exit 1
      ;;
  esac
  echo "Node.js installed."
fi
echo

# Open firewall ports
echo "Configuring firewall..."
if command -v ufw &>/dev/null; then
  ufw allow 8080/tcp    >/dev/null 2>&1 || true
  ufw allow 7880/tcp    >/dev/null 2>&1 || true
  ufw allow 7881/tcp    >/dev/null 2>&1 || true
  ufw allow 50000:60000/udp >/dev/null 2>&1 || true
  echo "UFW rules added."
elif command -v firewall-cmd &>/dev/null; then
  firewall-cmd --permanent --add-port=8080/tcp   >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-port=7880/tcp   >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-port=7881/tcp   >/dev/null 2>&1 || true
  firewall-cmd --permanent --add-port=50000-60000/udp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  echo "Firewalld rules added."
else
  echo "No firewall manager detected. Manually open ports: 8080/tcp, 7880/tcp, 7881/tcp, 50000-60000/udp"
fi
echo

# Run setup (reopen /dev/tty for interactive prompts when piped via curl)
echo "Running Migo setup..."
echo
node scripts/setup.mjs </dev/tty
