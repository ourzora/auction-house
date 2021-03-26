// @ts-ignore
import { ethers } from "hardhat";
import fs from "fs-extra";
import {
  ReserveAuction,
  ReserveAuction__factory,
  ZoraProxy,
  ZoraProxy__factory,
} from "../typechain";

async function main() {
  const args = require("minimist")(process.argv.slice(2));

  if (!args.chainId) {
    throw new Error("--chainId chain ID is required");
  }
  const path = `${process.cwd()}/.env${
    args.chainId === 1 ? ".prod" : args.chainId === 4 ? ".dev" : ".local"
  }`;
  await require("dotenv").config({ path });
  const provider = new ethers.providers.JsonRpcProvider(
    process.env.RPC_ENDPOINT
  );
  const wallet = new ethers.Wallet(`0x${process.env.PRIVATE_KEY}`, provider);
  const addressPath = `${process.cwd()}/addresses/${args.chainId}.json`;
  const protocolAddressPath = `${process.cwd()}/node_modules/@zoralabs/core/dist/addresses/${
    args.chainId
  }.json`;

  // @ts-ignore
  const addressBook = JSON.parse(await fs.readFileSync(addressPath));
  const protocolAddressBook = JSON.parse(
    // @ts-ignore
    await fs.readFileSync(protocolAddressPath)
  );

  if (!addressBook.weth) {
    throw new Error("Missing WETH address in address book.");
  }
  if (!protocolAddressBook.media) {
    throw new Error("Missing Media address in protocol address book.");
  }
  if (addressBook.reserveAuctionImplementation) {
    throw new Error(
      "reserveAuctionImplementation already in address book, it must be moved before deploying."
    );
  }
  if (addressBook.reserveAuctionProxy) {
    throw new Error(
      "reserveAuctionProxy already in address book, it must be moved before deploying."
    );
  }

  // We get the contract to deploy
  const ReserveAuction = (await ethers.getContractFactory(
    "ReserveAuction",
    wallet
  )) as ReserveAuction__factory;
  const ZoraProxy = (await ethers.getContractFactory(
    "ZoraProxy",
    wallet
  )) as ZoraProxy__factory;

  console.log("Deploying auction implementation...");
  const impl = await ReserveAuction.deploy();
  addressBook.reserveAuctionImplementation = impl.address;
  console.log("Deploying proxy...");
  const proxy = await ZoraProxy.deploy(impl.address, wallet.address);

  const auction = ReserveAuction.attach(proxy.address).connect(wallet);
  addressBook.reserveAuctionProxy = auction.address;
  console.log("Configuring auction proxy...");
  await auction.configure(protocolAddressBook.media, addressBook.weth);

  await fs.writeFile(addressPath, JSON.stringify(addressBook, null, 2));
  console.log("Reserve Auction contracts deployed and configured 📿");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
