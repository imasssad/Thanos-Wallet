$ErrorActionPreference = 'Continue'
Set-Location "d:\My Projects\Thanos Wallet\apps\mobile"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " EAS APK BUILD" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "When prompted for login:" -ForegroundColor Magenta
Write-Host "  Email or username : type your Expo USERNAME" -ForegroundColor Magenta
Write-Host "  Password          : type your password (nothing shows is normal)" -ForegroundColor Magenta
Write-Host ""

Write-Host "[1/3] Logging in to Expo..." -ForegroundColor Yellow
npx --yes eas-cli login
Write-Host ""

$me = npx --yes eas-cli whoami 2>&1
if ("$me" -like "*Not logged in*") {
  Write-Host "Login failed. Run this script again." -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit
}
Write-Host "Logged in as: $me" -ForegroundColor Green
Write-Host ""

Write-Host "[2/3] Initializing EAS project (one-time)..." -ForegroundColor Yellow
Write-Host "  If asked 'Create a project?' press Y" -ForegroundColor Cyan
npx --yes eas-cli init
Write-Host ""

Write-Host "[3/3] Queueing Android APK build (Expo cloud, ~10-15 min)..." -ForegroundColor Yellow
Write-Host "  If asked about generating a keystore: press Y" -ForegroundColor Cyan
Write-Host "  If asked about uncommitted changes:  press Y" -ForegroundColor Cyan
Write-Host ""
npx --yes eas-cli build --platform android --profile preview

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host " The APK download URL is in the output above." -ForegroundColor Green
Write-Host " Or visit https://expo.dev/accounts/$me/projects/thanos-wallet/builds" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Read-Host "Press Enter to close"
