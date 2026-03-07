# setup_php_phpenv.ps1
# PHP / phpenv Setup for WSL2

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "======================================="
Write-Host "PHP / phpenv Setup for WSL2"
Write-Host "======================================="
Write-Host ""
Write-Host "Retrieving available WSL distributions..."
Write-Host ""

# Get WSL distribution list (wsl -l -q outputs UTF-16LE)
$rawOutput = wsl.exe -l -q 2>$null
$distros = ($rawOutput -replace '\x00', '' -match '\S')

if (-not $distros -or $distros.Count -eq 0) {
    Write-Host "No WSL distributions found."
    Read-Host "Press Enter to exit"
    exit 1
}

# Display list
for ($i = 0; $i -lt $distros.Count; $i++) {
    Write-Host "[$($i + 1)] $($distros[$i])"
}

Write-Host ""
$selection = Read-Host "Select a distribution [1-$($distros.Count)]"
$selIndex = [int]$selection - 1

if ($selIndex -lt 0 -or $selIndex -ge $distros.Count) {
    Write-Host "Invalid selection."
    Read-Host "Press Enter to exit"
    exit 1
}

$WSL_DISTRO = $distros[$selIndex]

Write-Host ""
Write-Host "Selected Distribution: $WSL_DISTRO"
Write-Host ""
Write-Host "[1/3] Installing requirements in WSL ($WSL_DISTRO)..."

# Detect OS type and install dependencies
$installScript = @'
if command -v apt-get >/dev/null 2>&1; then
    echo "Detected Debian/Ubuntu based system (apt-get)"
    sudo apt-get update
    sudo apt-get install -y git curl build-essential libzip-dev zlib1g-dev libonig-dev libssl-dev libxml2-dev libsqlite3-dev libcurl4-openssl-dev libpng-dev libjpeg-dev libreadline-dev
elif command -v dnf >/dev/null 2>&1; then
    echo "Detected RedHat based system (dnf)"
    sudo dnf install -y oracle-epel-release-el9 oracle-epel-release-el8 epel-release 2>/dev/null || true
    sudo dnf install -y git curl gcc gcc-c++ make libzip-devel zlib-devel oniguruma-devel openssl-devel libxml2-devel sqlite-devel libcurl-devel libpng-devel libjpeg-devel readline-devel bzip2 bzip2-devel
elif command -v yum >/dev/null 2>&1; then
    echo "Detected RedHat based system (yum)"
    sudo yum install -y oracle-epel-release-el9 oracle-epel-release-el8 epel-release 2>/dev/null || true
    sudo yum install -y git curl gcc gcc-c++ make libzip-devel zlib-devel oniguruma-devel openssl-devel libxml2-devel sqlite-devel libcurl-devel libpng-devel libjpeg-devel readline-devel bzip2 bzip2-devel
else
    echo "Unknown package manager. Cannot install dependencies."
    exit 1
fi
'@

wsl.exe -d $WSL_DISTRO -e bash -c $installScript

Write-Host ""
Write-Host "[2/3] Installing phpenv..."
wsl.exe -d $WSL_DISTRO -e bash -c "curl -L https://raw.githubusercontent.com/phpenv/phpenv-installer/master/bin/phpenv-installer | bash"

Write-Host ""
Write-Host "[3/3] Configuring ~/.bashrc..."
wsl.exe -d $WSL_DISTRO -e bash -c "grep -q 'phpenv/bin' ~/.bashrc || echo 'export PATH=`"`$HOME/.phpenv/bin:`$PATH`"' >> ~/.bashrc"
wsl.exe -d $WSL_DISTRO -e bash -c "grep -q 'phpenv init' ~/.bashrc || echo 'eval `"`$(phpenv init -)`"' >> ~/.bashrc"

Write-Host ""
Write-Host "======================================="
Write-Host "Setup complete!"
Write-Host "Please restart your WSL terminal to apply the changes."
Write-Host "======================================="
Read-Host "Press Enter to exit"
