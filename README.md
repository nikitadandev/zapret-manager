# Zapret Manager

Понятный Windows-менеджер для официальной сборки [Flowseal/zapret-discord-youtube](https://github.com/Flowseal/zapret-discord-youtube).

## Что уже работает

- автоматическая фоновая проверка YouTube, Discord, GitHub и Telegram;
- установка и обновление официального ZIP-релиза с проверкой SHA-256;
- запуск и остановка стратегий `general*.bat`;
- последовательный тест стратегий и автоматический запуск лучшей;
- безопасный Electron bridge без Node.js в интерфейсе;
- демонстрационный режим для разработки не на Windows.

## Разработка

```bash
npm install
npm run dev
```

## Сборка для Windows

Собирать установщик нужно на Windows 10/11:

```powershell
npm install
npm run dist:win
```

Установщик запрашивает права администратора один раз при запуске: они нужны WinDivert и `winws.exe`. Ядро zapret не включается в установщик и загружается только из официальных релизов Flowseal.

Также в проекте есть workflow `Build Windows installer`: его можно запустить вручную на GitHub или создать тег `v*`, после чего готовый `.exe` появится в артефактах сборки.
