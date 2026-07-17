param(
  [string]$OutputPath = (Join-Path $PSScriptRoot "..\.test-storage\synthetic-meeting.wav")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$resolved = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($resolved)) | Out-Null
$speaker = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
  $speaker.Rate = -1
  $speaker.SetOutputToWaveFile($resolved)
  $speaker.Speak("This is a synthetic project meeting fixture. We decided to ship the private beta on Friday. Alex will prepare the release checklist by Thursday. The database migration remains an open question. No real people or private information are present in this recording.")
} finally {
  $speaker.Dispose()
}
Write-Output $resolved
