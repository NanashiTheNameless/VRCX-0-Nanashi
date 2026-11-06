[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
foreach ($name in @('NN_SIGNING_CERT_SHA1')) {
    if (-not [Environment]::GetEnvironmentVariable($name)) { throw "Missing $name" }
}
$thumbprint = $env:NN_SIGNING_CERT_SHA1
$storePath = "Cert:\CurrentUser\My\$thumbprint"
$existing = Test-Path -LiteralPath $storePath
try {
    if (-not $VerifyOnly -and -not $existing) {
        $password = ConvertTo-SecureString -String ([IO.File]::ReadAllText($env:NN_SIGNING_PASSWORD_FILE).Trim()) -AsPlainText -Force
        $certificate = Import-PfxCertificate -FilePath $env:NN_SIGNING_PFX_FILE -Password $password -CertStoreLocation 'Cert:\CurrentUser\My'
        if (-not ($certificate | Where-Object { $_.Thumbprint -eq $thumbprint -and $_.HasPrivateKey })) {
            throw 'Imported signing identity does not match the pinned certificate.'
        }
    }
    if (-not $VerifyOnly) {
        if (-not (Get-Item -LiteralPath $storePath).HasPrivateKey) {
            throw 'The selected signing identity has no private key.'
        }
        $tool = Get-Command signtool.exe -ErrorAction SilentlyContinue
        if ($tool) {
            $toolPath = $tool.Source
        } else {
            $sdk = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
            $version = Get-ChildItem -LiteralPath $sdk -Directory |
                Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' -and (Test-Path (Join-Path $_.FullName 'x64\signtool.exe')) } |
                Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
            if (-not $version) { throw 'Install Windows SDK SignTool before building signed packages.' }
            $toolPath = Join-Path $version.FullName 'x64\signtool.exe'
        }
        $file = (Resolve-Path -LiteralPath $FilePath).ProviderPath
        & $toolPath sign /s My /sha1 $thumbprint /fd SHA256 $file
        if ($LASTEXITCODE -ne 0) { throw 'SignTool could not sign the file.' }
    }
    $file = (Resolve-Path -LiteralPath $FilePath).ProviderPath
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $thumbprint -or
        $signature.Status -in @('HashMismatch', 'NotSigned')) {
        throw 'The resulting Authenticode signature does not match the expected identity.'
    }
    Write-Output "Authenticode checked: $file (trust status: $($signature.Status))"
} finally {
    if (-not $VerifyOnly -and -not $existing -and (Test-Path -LiteralPath $storePath)) {
        Remove-Item -LiteralPath $storePath -DeleteKey
    }
}
