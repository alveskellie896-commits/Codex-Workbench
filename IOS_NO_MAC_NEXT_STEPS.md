# No-Mac iOS App Next Steps

You do not need to own a Mac, but iOS still must be built on macOS somewhere. This repo now includes a GitHub Actions workflow that uses GitHub cloud macOS to build and upload the iOS app to TestFlight.

## What I already added

- `.github/workflows/ios-testflight.yml`
- `docs/ios-no-mac-testflight-zh.md`
- `scripts/encode-ios-signing-file.ps1`
- `ios/CodexWorkbench/INSTALL_ZH.md`

## The only things you still must provide

These cannot be generated safely by code because they belong to your Apple account:

- Apple Developer Program membership.
- App Store Connect app record.
- Apple Team ID.
- iOS Distribution certificate `.p12`.
- App Store provisioning profile `.mobileprovision`.
- App Store Connect API key.

## Dumb-simple path

1. Create a private GitHub repo and push this project.
2. Join Apple Developer Program.
3. Create an iOS app in App Store Connect with Bundle ID:

```text
com.keshi.codexworkbench
```

4. Create/download signing files from Apple Developer:

```text
certificate.p12
profile.mobileprovision
AuthKey_XXXXXXXXXX.p8
```

5. Convert the `.p12` and `.mobileprovision` files on Windows:

```powershell
.\scripts\encode-ios-signing-file.ps1 -Path C:\path\to\certificate.p12
.\scripts\encode-ios-signing-file.ps1 -Path C:\path\to\profile.mobileprovision
```

6. In GitHub repo settings, add the required Actions secrets from:

```text
docs/ios-no-mac-testflight-zh.md
```

7. Run:

```text
GitHub -> Actions -> iOS TestFlight -> Run workflow
```

8. Install from TestFlight on iPhone.

## Daily use after install

Keep the Windows computer on and run:

```powershell
npm run start:public
```

Open the iOS app and set Computer URL to the `Phone:` link in:

```text
current-phone-link.txt
```

## Important

Without Apple Developer signing files, nobody can legally create a TestFlight build for your Apple account. The code and cloud build pipeline are ready; the account/signing materials are the remaining gate.

## No-Money Route

If you cannot pay for Apple Developer Program, use the free sideloading route instead:

```text
docs/ios-free-sideload-zh.md
```

The free route builds an unsigned IPA in GitHub Actions and installs it with AltStore or Sideloadly. It is less stable than TestFlight and usually needs refreshing every 7 days.
