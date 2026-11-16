# Trazabilidad blockchain de vino con Denominación de Origen (Valle del Maule)

Proyecto del ramo de Blockchain, UCM. Red de consorcio Hyperledger Fabric (4 organizaciones, consenso Raft)
para prevenir el fraude de denominación de origen. Organización ficticia basada en información pública.

## Estructura
- `chaincode/`: chaincode `TrazabilidadVino` (JavaScript, fabric-contract-api)
- `app/`: aplicación cliente (Node.js + fabric-gateway) y gateway QR de solo lectura
- `scripts/`: scripts de red y de demo
- `docs/`: informe final y diagramas

## Requisitos
Docker, Node.js 20, jq y los binarios de Fabric 2.5 (`install-fabric.sh docker samples binary`).

## Puesta en marcha
(se completará al cerrar el despliegue)
