require('dotenv').config();
const axios = require('axios');
const Web3 = require('web3');
const cron = require('node-cron');
const ABI = require('./abi.js');

const GAS_SPEED = 'standard';
const GAS_COST_LIMIT_MATIC = 0.05;
const POLYGON_RPC_HOST = process.env.POLYGON_RPC_HOST || 'https://polygon-rpc.com/';
const POLYGON_GAS_STATION_HOST = 'https://gasstation.polygon.technology/v2';
const AAVEGOTCHI_DIAMOND_ADDRESS = '0x86935F11C86623deC8a25696E1C19a8659CbF95d';
const PETTER_WALLET_ADDRESS = process.env.PETTER_WALLET_ADDRESS;
const PETTER_WALLET_KEY = process.env.PETTER_WALLET_KEY;
const GOTCHI_IDS = process.env.GOTCHI_IDS.split(',');
const SECONDS_BETWEEN_PETS = 60 * 60 * 12;

const web3 = new Web3(POLYGON_RPC_HOST);
const contract = new web3.eth.Contract(ABI, AAVEGOTCHI_DIAMOND_ADDRESS);

function log(message) {
  console.log(`${new Date().toISOString().substring(0, 19)}: ${message}`);
}

async function getCurrentGasPrices() {
  try {
    const response = await axios.get(POLYGON_GAS_STATION_HOST);
    const gasData = response.data;
    if (gasData.error) {
      throw new Error(`Polygon gas station error: ${gasData.error.message}`);
    }
    if (typeof gasData[GAS_SPEED] === 'undefined') {
      throw new Error(`Polygon gas station response does not include data for gas speed '${GAS_SPEED}'`);
    }
    return gasData;
  } catch (error) {
    throw error;
  }
}

async function createPetTransaction(idsOfGotchisToPet) {
  return {
    from: PETTER_WALLET_ADDRESS,
    to: AAVEGOTCHI_DIAMOND_ADDRESS,
    data: contract.methods.interact(idsOfGotchisToPet).encodeABI(),
  };
}

async function setTransactionGasToMarket(tx) {
  const gasPrices = await getCurrentGasPrices();
  return {
    ...tx,
    gasLimit: await web3.eth.estimateGas(tx),
    maxPriorityFeePerGas: Math.ceil(gasPrices[GAS_SPEED].maxPriorityFee * 1e9),
  };
}

function signPetTransaction(unsignedTransaction) {
  return web3.eth.accounts.signTransaction(unsignedTransaction, PETTER_WALLET_KEY);
}

function sendPetTransaction(signedTransaction) {
  return web3.eth.sendSignedTransaction(signedTransaction.rawTransaction);
}

async function getGotchi(gotchiId) {
  return contract.methods.getAavegotchi(gotchiId).call();
}

function isReadyToBePet(gotchi) {
  const secondsSinceLastPet = Math.floor(Date.now() / 1000) - gotchi.lastInteracted;
  return secondsSinceLastPet > SECONDS_BETWEEN_PETS;
}

async function filterPettableGotchiIds(unfilteredIds) {
  const pettableIds = [];
  for (const id of unfilteredIds) {
    try {
      log(`Checking status of gotchi (id=${id})`);
      const gotchi = await getGotchi(id);
      log(`Found gotchi: (id=${gotchi.tokenId}, lastInteracted=${new Date(gotchi.lastInteracted * 1000)})`);
      if (isReadyToBePet(gotchi)) {
        pettableIds.push(id);
      } else {
        log(`Gotchi with id ${id} is not ready to be pet yet`);
      }
    } catch (err) {
      log(`Error while fetching gotchi (id=${id}): ${err}`);
      // Continue with the next Gotchi instead of breaking the loop
    }
  }
  return pettableIds;
}

async function petAavegotchis(ids) {
  if (ids.length === 0) {
    log('There are no gotchis to be pet at this time.');
    return;
  }

  log(`Petting gotchis with ids: ${ids}`);
  try {
    const petTransaction = await setTransactionGasToMarket(await createPetTransaction(ids));
    log(`Creating pet transaction: (from=${petTransaction.from}, to=${petTransaction.to}, gasLimit=${petTransaction.gasLimit}, maxPriorityFeePerGas=${petTransaction.maxPriorityFeePerGas})`);

    const gasPrices = await getCurrentGasPrices();
    const estimatedGasCostMatic = (petTransaction.gasLimit * (petTransaction.maxPriorityFeePerGas + gasPrices.estimatedBaseFee * 1e9)) / 1e18;
    log(`Estimated gas cost is ~${estimatedGasCostMatic.toFixed(6)} MATIC`);

    if (estimatedGasCostMatic > GAS_COST_LIMIT_MATIC) {
      log(`ABORTED: Estimated gas cost exceeds limit. GAS_COST_LIMIT_MATIC=${GAS_COST_LIMIT_MATIC}`);
      return;
    }

    const signedTransaction = await signPetTransaction(petTransaction);
    const receipt = await sendPetTransaction(signedTransaction);
    log(`Transaction complete. Hash: ${receipt.transactionHash}`);
  } catch (err) {
    log(`Error during petting process: ${err.message}`);
  }
}

async function petGotchis() {
  try {
    const pettableIds = await filterPettableGotchiIds(GOTCHI_IDS);
    await petAavegotchis(pettableIds);
  } catch (err) {
    log(`Error in main petting loop: ${err.message}`);
  }
}

// Run the petting process every 15 minutes
cron.schedule('*/15 * * * *', petGotchis);