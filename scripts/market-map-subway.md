# 클리닉 지도 지하철 노선 파일 만드는 법 (`public/market-map/subway.geojson`)

배경지도(OpenFreeMap)에는 지하철 노선이 동네 수준 확대(줌 14)부터만 들어 있고, 지하 구간은 그리지도 않는다. 그래서 오픈스트리트맵 노선 정보로 파일을 따로 만든다(2026-10-19, 수도권 24개 노선). 노선이 새로 생기면 아래 순서로 다시 만든다.

1. Overpass API(`https://overpass-api.de/api/interpreter`, User-Agent 필요)에서 두 가지를 `out geom;`으로 받는다(범위 36.9,126.4 ~ 38.0,127.6).
   - `relation["type"="route"]["route"~"^(subway|light_rail)$"]`
   - `relation["type"="route"]["route"="train"]["ref"~"^(경의·중앙|GTX-A|경춘|서해|수인·분당|신분당|공항철도)$"]` — 이 노선들은 OSM에서 '광역철도(train)'로 분류돼 있다.
2. 운행 계통(급행·구간 운행)마다 관계가 따로 있으므로 노선 이름으로 묶는다.
   - 숫자 노선은 `N호선`, 인천 도시철도는 `인천 N호선`, 나머지는 ref → 이름(경의중앙선·수인분당선·신분당선·공항철도·GTX-A·경춘선·서해선).
   - 색은 relation의 `colour`. 색이 없는 관계(공항 셔틀 등)는 뺀다.
3. 같은 선로를 여러 노선이 쓰면 먼저 만난 노선에 붙인다(숫자 노선 → 광역 → 경전철 순). 정류장·승강장 멤버는 빼고 선로(역할 없음)만 쓴다.
4. 노선마다 MultiLineString 하나로 담아 mapshaper로 줄인다: `mapshaper subway_raw.geojson -simplify 15% keep-shapes -o subway.geojson precision=0.00001 format=geojson`(약 0.26MB).

출처 표기: 데이터는 © OpenStreetMap 기여자(ODbL). 지도 아래 OpenFreeMap 표기에 이미 OpenStreetMap이 들어 있다.
