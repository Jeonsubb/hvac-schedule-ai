# ThermoPlan edge gateway: BACnet/IP to the central controller, outbound HTTPS to the cloud.
# Run with --network host so BACnet/IP (UDP 47808) reaches the controller on the building LAN.
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY edge_gateway.py virtual_controller.py ./
ENTRYPOINT ["python", "edge_gateway.py"]
