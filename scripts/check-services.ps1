$ports = @(
    @{ Name = "PostgreSQL"; Port = 5432 },
    @{ Name = "Redis"; Port = 6379 }
)

foreach ($service in $ports) {
    $available = Test-NetConnection -ComputerName "127.0.0.1" -Port $service.Port -InformationLevel Quiet -WarningAction SilentlyContinue
    $state = if ($available) { "可连接" } else { "不可连接" }
    Write-Output ("{0,-12} 127.0.0.1:{1} {2}" -f $service.Name, $service.Port, $state)
}

