# A bounded UI-test fixture: send real mouse input on the disposable Windows runner.
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'This fixture runs only in GitHub Actions.' }
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WorktrailTestInput {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public UIntPtr extraInfo; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public static void Move(int dx) { var i = new INPUT(); i.mouse.dx = dx; i.mouse.flags = 1; if (SendInput(1, new[]{i}, Marshal.SizeOf(typeof(INPUT))) != 1) throw new Exception("Windows test input failed"); }
}
'@
for ($i = 0; $i -lt 120; $i++) {
  [WorktrailTestInput]::Move($(if ($i % 2 -eq 0) { 1 } else { -1 }))
  Start-Sleep -Seconds 3
}
