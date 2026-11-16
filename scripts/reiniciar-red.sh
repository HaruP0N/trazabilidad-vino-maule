#!/usr/bin/env bash
# Reinicio limpio de la red de 4 orgs (canal "vino").
set -u
cd ~/vino/fabric-samples/test-network || exit 1

echo ">> Bajando la red y limpiando restos..."
./network.sh down
docker rm -f $(docker ps -aq) 2>/dev/null
docker volume rm $(docker volume ls -q | grep -E "peer0\.org|orderer\.example\.com") 2>/dev/null
sudo rm -rf addOrg4/fabric-ca/org4/msp addOrg4/fabric-ca/org4/tls-cert.pem \
            addOrg4/fabric-ca/org4/ca-cert.pem addOrg4/fabric-ca/org4/IssuerPublicKey \
            addOrg4/fabric-ca/org4/IssuerRevocationPublicKey addOrg4/fabric-ca/org4/fabric-ca-server.db

echo ">> Levantando Org1, Org2 y el canal vino..."
./network.sh up createChannel -c vino -ca -s couchdb || { echo "FALLO: red base"; exit 1; }

echo ">> Agregando Org3..."
(cd addOrg3 && ./addOrg3.sh up -c vino -ca -s couchdb) || { echo "FALLO: Org3"; exit 1; }

echo ">> Agregando Org4..."
(cd addOrg4 && ./addOrg4.sh up -c vino -ca -s couchdb) || { echo "FALLO: Org4"; exit 1; }

echo ">> Red lista:"
docker ps --format "table {{.Names}}\t{{.Status}}" | grep -E "peer0|orderer|couchdb"
