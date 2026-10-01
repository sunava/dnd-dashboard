# Kampagnenatlas

Interaktive Karte, durchsuchbares Wiki und Beziehungen über den vorhandenen Supabase-Daten. Der Spieltisch enthält weiterhin die bisherigen Editoren und DM-Werkzeuge.

## Lokal

`npm start` startet die Vorschau auf http://127.0.0.1:4173. Ohne Login werden die vorhandenen öffentlichen Kampagnendaten gelesen. Änderungen nach dem DM-Login gehen an die konfigurierte Datenbank.

## Bedienung

- Karte mit Maus oder Touch verschieben; Mausrad, Pinch oder +/− zum Zoomen. Tastatur: Pfeile, +/−, 0 zum Einpassen.
- Orte anklicken oder im Verzeichnis suchen. Namen im Beschreibungstext führen zu passenden Einträgen.
- Als DM: „+ Ort“ aktivieren und auf die Karte klicken. Beschreibungen und Wiki-Einträge bearbeiten, beschriftete Beziehungen anlegen oder entfernen.
- Das Wiki zeigt Orte, NPCs, Quests, Fraktionen und Sitzungen. Die DM-Bibliothek erscheint ausschließlich in der angemeldeten Ansicht.
- Neue Wiki-Einträge und Beziehungen sind öffentlich. Geheimnisse gehören weiterhin in die DM-Bibliothek.

## Daten und Zugriff

Keine Migration erforderlich. Bestehende Kartenkoordinaten bleiben in Prozent. Neue öffentliche Felder unter dem bestehenden `kv`-Eintrag `map`: `entries` (id, title, category, body) und `links` (id, from, to, label). Referenzen verwenden Typpräfixe, etwa `place:<id>` oder `npc:<id>`; ungültige Verbindungen werden nicht angezeigt. Die bisherigen Datenfelder bleiben erhalten.

`kv_dm` und die bestehende Supabase-Authentifizierung bleiben getrennt. Die Datenbank-RLS muss weiterhin echte Zugriffsrechte erzwingen; der Frontend-Rollenstatus ersetzt keine Datenbankberechtigung. Keine geheimen Schlüssel in Frontend-Dateien eintragen.

## Tests

`npm install`, `npx playwright install chromium`, dann `npm test`. Alternativ kann ein installierter Edge-Browser mit `TEST_BROWSER_CHANNEL=msedge` verwendet werden.

Die Browsertests simulieren Supabase vollständig und verändern keine produktiven Daten. Sie prüfen Karte/Zoom, Suche, Wiki, Beziehungen, Koordinaten neuer Orte, Erhalt bestehender Daten, Speicherfehler und Wiederholung, sichere Textdarstellung, DM-Logout und mobile Breite. Screenshots werden in `test-results/` abgelegt.
