# 현장 게이트웨이와 가상 중앙제어기

ThermoPlan이 건물 중앙제어기와 실제로 통신하는 경로입니다.

```
[ThermoPlan 클라우드] ◀── HTTPS (게이트웨이가 나가는 연결만) ── [edge_gateway.py] ── BACnet/IP (UDP 47808) ── [중앙제어기]
```

- `edge_gateway.py`: 건물 내부망에 설치하는 게이트웨이입니다.
  - 중앙제어기를 BACnet으로 찾고(Who-Is/I-Am) 객체 목록과 이름을 읽어 강의실에 매핑합니다.
  - 15초마다 현재값을 읽어 클라우드에 보냅니다(`/api/gateway/telemetry`).
  - 응답으로 받은 명령(설정온도, 환기 단계)을 우선순위 8로 쓰고 되읽어 결과를 보고합니다(`/api/gateway/ack`).
  - 기본은 **읽기 전용**이고, `--allow-write`를 줄 때만 장비에 씁니다. 설정온도는 16~30℃, 환기 단계는 1~3만 받습니다.
- `virtual_controller.py`: 실제 중앙제어기에 접근하기 전까지 대신 쓰는 **BACnet/IP 장치**입니다.
  - IT관 실내기 19대(OnOff, RoomTemp, HeatSetpoint, CoolSetpoint), 강의실 10곳의 환기(FanLevel)·CO₂·Wi-Fi 인원, 실외기 3대 전력을 BACnet 객체 109개로 노출합니다.
  - 값은 클라우드 열모델 시뮬레이터(`/api/live`)를 30초마다 따라갑니다.
  - 쓰기는 각 객체의 우선순위 배열에 남고 로그에 찍힙니다.

## 데모 실행 (이 Mac에서)

```bash
cd gateway
./run_demo.sh start            # 가상 중앙제어기 + 게이트웨이(쓰기 허용), 연결 코드 DEMO-PNU1
./run_demo.sh logs             # BACnet 읽기·쓰기 로그
./run_demo.sh stop
```

- 사이트의 운영 규칙 → 건물 연결과 정책 → "현장 게이트웨이"에 온라인 상태와 실시간 값이 나옵니다.
- 온보딩 2단계에서 "현장 게이트웨이 설치"를 고르고 주소 `127.0.0.1`, 포트 `47808`, 연결 코드 칸의 코드를 `DEMO-PNU1`로 맞춘 뒤 연결 테스트를 누르면, 시뮬레이터 대신 게이트웨이가 읽은 값이 나옵니다(`./run_demo.sh start 코드`로 화면의 코드를 써도 됩니다).
- 조정안을 승인하면 명령이 "대기 → 게이트웨이로 전송 → 쓰기·되읽기 확인"으로 바뀌고, `controller.log`에 `WRITE 수신`이 찍힙니다.

## 실제 중앙제어기에 붙일 때

1. 시설과 승인을 받고, 중앙제어기의 BACnet/IP 연동 기능(제조사 옵션인 경우가 많음)이 켜져 있는지 확인합니다.
2. 같은 내부망의 PC에서 **읽기 전용**으로 시작합니다.
   ```bash
   docker build -t thermoplan-gateway gateway/
   docker run -d --restart=always --network host thermoplan-gateway \
     --pair <연결 코드> --controller <중앙제어기 IP>:47808 --local <이 PC의 IP>/<마스크>:47808
   ```
3. 객체 이름이 `IDU-306-1/HeatSetpoint` 규칙과 다르면 `backend/app/gateway.py`의 `NAME_RE` 매핑을 현장 이름에 맞춥니다.
4. 몇 주 동안 읽은 값으로 시뮬레이터를 실측과 맞춘 뒤(ASHRAE Guideline 14), 시설과와 정한 강의실·시간에만 `--allow-write`를 켭니다.
5. 되돌릴 때는 우선순위 8을 비우면(relinquish) 중앙제어기의 원래 설정으로 돌아갑니다.

macOS에서 루프백 주소로 실행할 때는 `/32` 마스크를 씁니다. 브로드캐스트 소켓을 만들지 않고 유니캐스트 Who-Is만 씁니다.
