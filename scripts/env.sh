export NET=$HOME/vino/fabric-samples/test-network
export ORDERER_CA=$NET/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem

setOrg() {  # uso: setOrg 1|2|3|4
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="Org$1MSP"
  export CORE_PEER_TLS_ROOTCERT_FILE=$NET/organizations/peerOrganizations/org$1.example.com/peers/peer0.org$1.example.com/tls/ca.crt
  export CORE_PEER_MSPCONFIGPATH=$NET/organizations/peerOrganizations/org$1.example.com/users/Admin@org$1.example.com/msp
  case $1 in 1) P=7051;; 2) P=9051;; 3) P=11051;; 4) P=13051;; esac
  export CORE_PEER_ADDRESS=localhost:$P
}
