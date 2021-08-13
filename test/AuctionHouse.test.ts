import chai, { expect } from "chai";
import asPromised from "chai-as-promised";
// @ts-ignore
import { ethers } from "hardhat";
import { Market, Media } from "@zoralabs/core/dist/typechain";
import { AuctionHouse, BadBidder, TestERC721, BadERC721 } from "../typechain";
import { formatUnits } from "ethers/lib/utils";
import { BigNumber, Contract, Signer } from "ethers";
import {
  approveAuction,
  deployBidder,
  deployOtherNFTs,
  deployWETH,
  deployZoraProtocol,
  mint,
  ONE_ETH,
  revert,
  TWO_ETH,
} from "./utils";

chai.use(asPromised);
const buyItNowPrice =  BigNumber.from(10).pow(18).mul(10)

describe("AuctionHouse", () => {
  let market: Market;
  let media: Media;
  let weth: Contract;
  let badERC721: BadERC721;
  let testERC721: TestERC721;

  beforeEach(async () => {
    await ethers.provider.send("hardhat_reset", []);
    const contracts = await deployZoraProtocol();
    const nfts = await deployOtherNFTs();
    market = contracts.market;
    media = contracts.media;
    weth = await deployWETH();
    badERC721 = nfts.bad;
    testERC721 = nfts.test;
  });

  async function deploy(): Promise<AuctionHouse> {
    const AuctionHouse = await ethers.getContractFactory("AuctionHouse");
    const auctionHouse = await AuctionHouse.deploy(media.address, weth.address);

    return auctionHouse as AuctionHouse;
  }

  async function createAuction(
    auctionHouse: AuctionHouse,
    curator: string,
    currency = "0x0000000000000000000000000000000000000000"
  ) {
    const tokenId = 0;
    const duration = 60 * 60 * 24;
    const reservePrice = BigNumber.from(10).pow(18).div(2);

    await auctionHouse.createAuction(
      tokenId,
      media.address,
      duration,
      reservePrice,
      curator,
      5,
      currency,
      buyItNowPrice
    );
  }

  describe("#constructor", () => {
    it("should be able to deploy", async () => {
      const AuctionHouse = await ethers.getContractFactory("AuctionHouse");
      const auctionHouse = await AuctionHouse.deploy(
        media.address,
        weth.address
      );

      expect(await auctionHouse.zora()).to.eq(
        media.address,
        "incorrect zora address"
      );
      expect(formatUnits(await auctionHouse.timeBuffer(), 0)).to.eq(
        "900"
      );
      expect(await auctionHouse.minBidIncrementPercentage()).to.eq(
        5
      );
    });

    it("should not allow a configuration address that is not the Zora Media Protocol", async () => {
      const AuctionHouse = await ethers.getContractFactory("AuctionHouse");
      await expect(
        AuctionHouse.deploy(market.address, weth.address)
      ).eventually.rejected;
    });
  });

  describe("#createAuction", () => {
    let auctionHouse: AuctionHouse;
    beforeEach(async () => {
      auctionHouse = await deploy();
      await mint(media);
      await approveAuction(media, auctionHouse);
    });

    it("should revert if the token contract does not support the ERC721 interface", async () => {
      const duration = 60 * 60 * 24;
      const reservePrice = BigNumber.from(10).pow(18).div(2);
      const [_, curator] = await ethers.getSigners();

      await expect(
        auctionHouse.createAuction(
          0,
          badERC721.address,
          duration,
          reservePrice,
          curator.address,
          5,
          "0x0000000000000000000000000000000000000000",
          buyItNowPrice
        )
      ).eventually.rejected;
    });

    it("should revert if the caller is not approved", async () => {
      const duration = 60 * 60 * 24;
      const reservePrice = BigNumber.from(10).pow(18).div(2);
      const [_, curator, __, ___, unapproved] = await ethers.getSigners();
      await expect(
        auctionHouse
          .connect(unapproved)
          .createAuction(
            0,
            media.address,
            duration,
            reservePrice,
            curator.address,
            5,
            "0x0000000000000000000000000000000000000000",
            buyItNowPrice
          )
      ).eventually.rejected;
    });

    it("should revert if the token ID does not exist", async () => {
      const tokenId = 999;
      const duration = 60 * 60 * 24;
      const reservePrice = BigNumber.from(10).pow(18).div(2);
      const owner = await media.ownerOf(0);
      const [admin, curator] = await ethers.getSigners();

      await expect(
        auctionHouse
          .connect(admin)
          .createAuction(
            tokenId,
            media.address,
            duration,
            reservePrice,
            curator.address,
            5,
            "0x0000000000000000000000000000000000000000",
            buyItNowPrice
          )
      ).eventually.rejected;
    });

    it("should revert if the curator fee percentage is >= 100", async () => {
      const duration = 60 * 60 * 24;
      const reservePrice = BigNumber.from(10).pow(18).div(2);
      const owner = await media.ownerOf(0);
      const [_, curator] = await ethers.getSigners();

      await expect(
        auctionHouse.createAuction(
          0,
          media.address,
          duration,
          reservePrice,
          curator.address,
          100,
          "0x0000000000000000000000000000000000000000",
          buyItNowPrice
        )
      ).eventually.rejected;
    });

    it("should create an auction", async () => {
      const owner = await media.ownerOf(0);
      const [_, expectedCurator] = await ethers.getSigners();
      await createAuction(auctionHouse, await expectedCurator.getAddress());

      const createdAuction = await auctionHouse.auctions(0);

      expect(createdAuction.duration).to.eq(24 * 60 * 60);
      expect(createdAuction.reservePrice).to.eq(
        BigNumber.from(10).pow(18).div(2)
      );
      expect(createdAuction.curatorFeePercentage).to.eq(5);
      expect(createdAuction.tokenOwner).to.eq(owner);
      expect(createdAuction.curator).to.eq(expectedCurator.address);
      expect(createdAuction.approved).to.eq(false);
    });

    it("should be automatically approved if the creator is the curator", async () => {
      const owner = await media.ownerOf(0);
      await createAuction(auctionHouse, owner);

      const createdAuction = await auctionHouse.auctions(0);

      expect(createdAuction.approved).to.eq(true);
    });

    it("should be automatically approved if the creator is the Zero Address", async () => {
      await createAuction(auctionHouse, ethers.constants.AddressZero);

      const createdAuction = await auctionHouse.auctions(0);

      expect(createdAuction.approved).to.eq(true);
    });

    it("should emit an AuctionCreated event", async () => {
      const owner = await media.ownerOf(0);
      const [_, expectedCurator] = await ethers.getSigners();

      const block = await ethers.provider.getBlockNumber();
      await createAuction(auctionHouse, await expectedCurator.getAddress());
      const currAuction = await auctionHouse.auctions(0);
      const events = await auctionHouse.queryFilter(
        auctionHouse.filters.AuctionCreated(
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null
        ),
        block
      );
      expect(events.length).eq(1);
      const logDescription = auctionHouse.interface.parseLog(events[0]);
      expect(logDescription.name).to.eq("AuctionCreated");
      expect(logDescription.args.duration).to.eq(currAuction.duration);
      expect(logDescription.args.reservePrice).to.eq(currAuction.reservePrice);
      expect(logDescription.args.tokenOwner).to.eq(currAuction.tokenOwner);
      expect(logDescription.args.curator).to.eq(currAuction.curator);
      expect(logDescription.args.curatorFeePercentage).to.eq(
        currAuction.curatorFeePercentage
      );
      expect(logDescription.args.auctionCurrency).to.eq(
        ethers.constants.AddressZero
      );
    });
  });

  describe("#setAuctionApproval", () => {
    let auctionHouse: AuctionHouse;
    let admin: Signer;
    let curator: Signer;
    let bidder: Signer;

    beforeEach(async () => {
      [admin, curator, bidder] = await ethers.getSigners();
      auctionHouse = (await deploy()).connect(curator) as AuctionHouse;
      await mint(media);
      await approveAuction(media, auctionHouse);
      await createAuction(
        auctionHouse.connect(admin),
        await curator.getAddress()
      );
    });

    it("should revert if the auctionHouse does not exist", async () => {
      await expect(
        auctionHouse.setAuctionApproval(1, true)
      ).eventually.rejected;
    });

    it("should revert if not called by the curator", async () => {
      await expect(
        auctionHouse.connect(admin).setAuctionApproval(0, true)
      ).eventually.rejected;
    });

    it("should revert if the auction has already started", async () => {
      await auctionHouse.setAuctionApproval(0, true);
      await auctionHouse
        .connect(bidder)
        .createBid(0, ONE_ETH, { value: ONE_ETH });
      await expect(
        auctionHouse.setAuctionApproval(0, false)
      ).eventually.rejected;
    });

    it("should set the auction as approved", async () => {
      await auctionHouse.setAuctionApproval(0, true);

      expect((await auctionHouse.auctions(0)).approved).to.eq(true);
    });

    it("should emit an AuctionApproved event", async () => {
      const block = await ethers.provider.getBlockNumber();
      await auctionHouse.setAuctionApproval(0, true);
      const events = await auctionHouse.queryFilter(
        auctionHouse.filters.AuctionApprovalUpdated(null, null, null, null),
        block
      );
      expect(events.length).eq(1);
      const logDescription = auctionHouse.interface.parseLog(events[0]);

      expect(logDescription.args.approved).to.eq(true);
    });
  });

  describe("#setAuctionReservePrice", () => {
    let auctionHouse: AuctionHouse;
    let admin: Signer;
    let creator: Signer;
    let curator: Signer;
    let bidder: Signer;

    beforeEach(async () => {
      [admin, creator, curator, bidder] = await ethers.getSigners();
      auctionHouse = (await deploy()).connect(curator) as AuctionHouse;
      await mint(media.connect(creator));
      await approveAuction(
        media.connect(creator),
        auctionHouse.connect(creator)
      );
      await createAuction(
        auctionHouse.connect(creator),
        await curator.getAddress()
      );
    });

    it("should revert if the auctionHouse does not exist", async () => {
      await expect(
        auctionHouse.setAuctionReservePrice(1, TWO_ETH)
      ).eventually.rejected;
    });

    it("should revert if not called by the curator or owner", async () => {
      await expect(
        auctionHouse.connect(admin).setAuctionReservePrice(0, TWO_ETH)
      ).eventually.rejected;
    });

    it("should revert if the auction has already started", async () => {
      await auctionHouse.setAuctionReservePrice(0, TWO_ETH);
      await auctionHouse.setAuctionApproval(0, true);
      await auctionHouse
        .connect(bidder)
        .createBid(0, TWO_ETH, { value: TWO_ETH });
      await expect(
        auctionHouse.setAuctionReservePrice(0, ONE_ETH)
      ).eventually.rejected;
    });

    it("should set the auction reserve price when called by the curator", async () => {
      await auctionHouse.setAuctionReservePrice(0, TWO_ETH);

      expect((await auctionHouse.auctions(0)).reservePrice).to.eq(TWO_ETH);
    });

    it("should set the auction reserve price when called by the token owner", async () => {
      await auctionHouse.connect(creator).setAuctionReservePrice(0, TWO_ETH);

      expect((await auctionHouse.auctions(0)).reservePrice).to.eq(TWO_ETH);
    });

    it("should emit an AuctionReservePriceUpdated event", async () => {
      const block = await ethers.provider.getBlockNumber();
      await auctionHouse.setAuctionReservePrice(0, TWO_ETH);
      const events = await auctionHouse.queryFilter(
        auctionHouse.filters.AuctionReservePriceUpdated(null, null, null, null),
        block
      );
      expect(events.length).eq(1);
      const logDescription = auctionHouse.interface.parseLog(events[0]);

      expect(logDescription.args.reservePrice).to.eq(TWO_ETH);
    });
  });

  describe("#createBid", () => {
    let auctionHouse: AuctionHouse;
    let admin: Signer;
    let curator: Signer;
    let bidderA: Signer;
    let bidderB: Signer;

    beforeEach(async () => {
      [admin, curator, bidderA, bidderB] = await ethers.getSigners();
      auctionHouse = (await (await deploy()).connect(bidderA)) as AuctionHouse;
      await mint(media);
      await approveAuction(media, auctionHouse);
      await createAuction(
        auctionHouse.connect(admin),
        await curator.getAddress()
      );
      await auctionHouse.connect(curator).setAuctionApproval(0, true);
    });

    it("should revert if the specified auction does not exist", async () => {
      await expect(
        auctionHouse.createBid(11111, ONE_ETH)
      ).eventually.rejected;
    });

    it("should revert if the specified auction is not approved", async () => {
      await auctionHouse.connect(curator).setAuctionApproval(0, false);
      await expect(
        auctionHouse.createBid(0, ONE_ETH, { value: ONE_ETH })
      ).eventually.rejected;
    });

    it("should revert if the bid is less than the reserve price", async () => {
      await expect(
        auctionHouse.createBid(0, 0, { value: 0 })
      ).eventually.rejected;
    });

    it("should revert if the bid is invalid for share splitting", async () => {
      await expect(
        auctionHouse.createBid(0, ONE_ETH.add(1), {
          value: ONE_ETH.add(1),
        })
      ).eventually.rejected;
    });

    it("should revert if msg.value does not equal specified amount", async () => {
      await expect(
        auctionHouse.createBid(0, ONE_ETH, {
          value: ONE_ETH.mul(2),
        })
      ).eventually.rejected;
    });
    describe("first bid", () => {
      it("should set the first bid time", async () => {
        // TODO: Fix this test on Sun Oct 04 2274
        await ethers.provider.send("evm_setNextBlockTimestamp", [9617249934]);
        await auctionHouse.createBid(0, ONE_ETH, {
          value: ONE_ETH,
        });
        expect((await auctionHouse.auctions(0)).firstBidTime).to.eq(9617249934);
      });

      it("should store the transferred ETH as WETH", async () => {
        await auctionHouse.createBid(0, ONE_ETH, {
          value: ONE_ETH,
        });
        expect(await weth.balanceOf(auctionHouse.address)).to.eq(ONE_ETH);
      });

      it("should not update the auction's duration", async () => {
        const beforeDuration = (await auctionHouse.auctions(0)).duration;
        await auctionHouse.createBid(0, ONE_ETH, {
          value: ONE_ETH,
        });
        const afterDuration = (await auctionHouse.auctions(0)).duration;

        expect(beforeDuration).to.eq(afterDuration);
      });

      it("should store the bidder's information", async () => {
        await auctionHouse.createBid(0, ONE_ETH, {
          value: ONE_ETH,
        });
        const currAuction = await auctionHouse.auctions(0);

        expect(currAuction.bidder).to.eq(await bidderA.getAddress());
        expect(currAuction.amount).to.eq(ONE_ETH);
      });

      it("should emit an AuctionBid event", async () => {
        const block = await ethers.provider.getBlockNumber();
        await auctionHouse.createBid(0, ONE_ETH, {
          value: ONE_ETH,
        });
        const events = await auctionHouse.queryFilter(
          auctionHouse.filters.AuctionBid(
            null,
            null,
            null,
            null,
            null,
            null,
            null
          ),
          block
        );
        expect(events.length).eq(1);
        const logDescription = auctionHouse.interface.parseLog(events[0]);

        expect(logDescription.name).to.eq("AuctionBid");
        expect(logDescription.args.auctionId).to.eq(0);
        expect(logDescription.args.sender).to.eq(await bidderA.getAddress());
        expect(logDescription.args.value).to.eq(ONE_ETH);
        expect(logDescription.args.firstBid).to.eq(true);
        expect(logDescription.args.extended).to.eq(false);
      });

      it("buyItNow should work", async () => {
        const block = await ethers.provider.getBlockNumber();
        await auctionHouse.createBid(0, buyItNowPrice, {
          value: buyItNowPrice,
        });
        const events = await auctionHouse.queryFilter(
          auctionHouse.filters.AuctionEnded(
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null
          ),
          block
        );
        expect(events.length).eq(1);
        expect(await media.ownerOf(0)).to.eq(await bidderA.getAddress())
      });
    });

    describe("second bid", () => {
      beforeEach(async () => {
        auctionHouse = auctionHouse.connect(bidderB) as AuctionHouse;
        await auctionHouse
          .connect(bidderA)
          .createBid(0, ONE_ETH, { value: ONE_ETH });
      });

      it("should revert if the bid is smaller than the last bid + minBid", async () => {
        await expect(
          auctionHouse.createBid(0, ONE_ETH.add(1), {
            value: ONE_ETH.add(1),
          })
        ).eventually.rejected;
      });

      it("should refund the previous bid", async () => {
        const beforeBalance = await ethers.provider.getBalance(
          await bidderA.getAddress()
        );
        const beforeBidAmount = (await auctionHouse.auctions(0)).amount;
        await auctionHouse.createBid(0, TWO_ETH, {
          value: TWO_ETH,
        });
        const afterBalance = await ethers.provider.getBalance(
          await bidderA.getAddress()
        );

        expect(afterBalance).to.eq(beforeBalance.add(beforeBidAmount));
      });

      it("should not update the firstBidTime", async () => {
        const firstBidTime = (await auctionHouse.auctions(0)).firstBidTime;
        await auctionHouse.createBid(0, TWO_ETH, {
          value: TWO_ETH,
        });
        expect((await auctionHouse.auctions(0)).firstBidTime).to.eq(
          firstBidTime
        );
      });

      it("should transfer the bid to the contract and store it as WETH", async () => {
        await auctionHouse.createBid(0, TWO_ETH, {
          value: TWO_ETH,
        });

        expect(await weth.balanceOf(auctionHouse.address)).to.eq(TWO_ETH);
      });

      it("should update the stored bid information", async () => {
        await auctionHouse.createBid(0, TWO_ETH, {
          value: TWO_ETH,
        });

        const currAuction = await auctionHouse.auctions(0);

        expect(currAuction.amount).to.eq(TWO_ETH);
        expect(currAuction.bidder).to.eq(await bidderB.getAddress());
      });

      it("should not extend the duration of the bid if outside of the time buffer", async () => {
        const beforeDuration = (await auctionHouse.auctions(0)).duration;
        await auctionHouse.createBid(0, TWO_ETH, {
          value: TWO_ETH,
        });
        const afterDuration = (await auctionHouse.auctions(0)).duration;
        expect(beforeDuration).to.eq(afterDuration);
      });

      it("should emit an AuctionBid event", async () => {
        const block = await ethers.provider.getBlockNumber();
        await auctionHouse.createBid(0, TWO_ETH, {
          value: TWO_ETH,
        });
        const events = await auctionHouse.queryFilter(
          auctionHouse.filters.AuctionBid(
            null,
            null,
            null,
            null,
            null,
            null,
            null
          ),
          block
        );
        expect(events.length).eq(2);
        const logDescription = auctionHouse.interface.parseLog(events[1]);

        expect(logDescription.name).to.eq("AuctionBid");
        expect(logDescription.args.sender).to.eq(await bidderB.getAddress());
        expect(logDescription.args.value).to.eq(TWO_ETH);
        expect(logDescription.args.firstBid).to.eq(false);
        expect(logDescription.args.extended).to.eq(false);
      });

      describe("last minute bid", () => {
        beforeEach(async () => {
          const currAuction = await auctionHouse.auctions(0);
          await ethers.provider.send("evm_setNextBlockTimestamp", [
            currAuction.firstBidTime
              .add(currAuction.duration)
              .sub(1)
              .toNumber(),
          ]);
        });
        it("should extend the duration of the bid if inside of the time buffer", async () => {
          const beforeDuration = (await auctionHouse.auctions(0)).duration;
          await auctionHouse.createBid(0, TWO_ETH, {
            value: TWO_ETH,
          });

          const currAuction = await auctionHouse.auctions(0);
          expect(currAuction.duration).to.eq(
            beforeDuration.add(await auctionHouse.timeBuffer()).sub(1)
          );
        });
        it("should emit an AuctionBid event", async () => {
          const block = await ethers.provider.getBlockNumber();
          await auctionHouse.createBid(0, TWO_ETH, {
            value: TWO_ETH,
          });
          const events = await auctionHouse.queryFilter(
            auctionHouse.filters.AuctionBid(
              null,
              null,
              null,
              null,
              null,
              null,
              null
            ),
            block
          );
          expect(events.length).eq(2);
          const logDescription = auctionHouse.interface.parseLog(events[1]);

          expect(logDescription.name).to.eq("AuctionBid");
          expect(logDescription.args.sender).to.eq(await bidderB.getAddress());
          expect(logDescription.args.value).to.eq(TWO_ETH);
          expect(logDescription.args.firstBid).to.eq(false);
          expect(logDescription.args.extended).to.eq(true);
        });
      });
      describe("late bid", () => {
        beforeEach(async () => {
          const currAuction = await auctionHouse.auctions(0);
          await ethers.provider.send("evm_setNextBlockTimestamp", [
            currAuction.firstBidTime
              .add(currAuction.duration)
              .add(1)
              .toNumber(),
          ]);
        });

        it("should revert if the bid is placed after expiry", async () => {
          await expect(
            auctionHouse.createBid(0, TWO_ETH, {
              value: TWO_ETH,
            })
          ).eventually.rejected;
        });
      });
    });
  });

  describe("#cancelAuction", () => {
    let auctionHouse: AuctionHouse;
    let admin: Signer;
    let creator: Signer;
    let curator: Signer;
    let bidder: Signer;

    beforeEach(async () => {
      [admin, creator, curator, bidder] = await ethers.getSigners();
      auctionHouse = (await deploy()).connect(creator) as AuctionHouse;
      await mint(media.connect(creator));
      await approveAuction(media.connect(creator), auctionHouse);
      await createAuction(
        auctionHouse.connect(creator),
        await curator.getAddress()
      );
      await auctionHouse.connect(curator).setAuctionApproval(0, true);
    });

    it("should revert if the auction does not exist", async () => {
      await expect(auctionHouse.cancelAuction(12213)).eventually.rejected;
    });

    it("should revert if not called by a creator or curator", async () => {
      await expect(
        auctionHouse.connect(bidder).cancelAuction(0)
      ).eventually.rejected;
    });

    it("should revert if the auction has already begun", async () => {
      await auctionHouse
        .connect(bidder)
        .createBid(0, ONE_ETH, { value: ONE_ETH });
      await expect(auctionHouse.cancelAuction(0)).eventually.rejected;
    });

    it("should be callable by the creator", async () => {
      await auctionHouse.cancelAuction(0);

      const auctionResult = await auctionHouse.auctions(0);

      expect(auctionResult.amount.toNumber()).to.eq(0);
      expect(auctionResult.duration.toNumber()).to.eq(0);
      expect(auctionResult.firstBidTime.toNumber()).to.eq(0);
      expect(auctionResult.reservePrice.toNumber()).to.eq(0);
      expect(auctionResult.curatorFeePercentage).to.eq(0);
      expect(auctionResult.tokenOwner).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.bidder).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.curator).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.auctionCurrency).to.eq(ethers.constants.AddressZero);

      expect(await media.ownerOf(0)).to.eq(await creator.getAddress());
    });

    it("should be callable by the curator", async () => {
      await auctionHouse.connect(curator).cancelAuction(0);

      const auctionResult = await auctionHouse.auctions(0);

      expect(auctionResult.amount.toNumber()).to.eq(0);
      expect(auctionResult.duration.toNumber()).to.eq(0);
      expect(auctionResult.firstBidTime.toNumber()).to.eq(0);
      expect(auctionResult.reservePrice.toNumber()).to.eq(0);
      expect(auctionResult.curatorFeePercentage).to.eq(0);
      expect(auctionResult.tokenOwner).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.bidder).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.curator).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.auctionCurrency).to.eq(ethers.constants.AddressZero);
      expect(await media.ownerOf(0)).to.eq(await creator.getAddress());
    });

    it("should emit an AuctionCanceled event", async () => {
      const block = await ethers.provider.getBlockNumber();
      await auctionHouse.cancelAuction(0);
      const events = await auctionHouse.queryFilter(
        auctionHouse.filters.AuctionCanceled(null, null, null, null),
        block
      );
      expect(events.length).eq(1);
      const logDescription = auctionHouse.interface.parseLog(events[0]);

      expect(logDescription.args.tokenId.toNumber()).to.eq(0);
      expect(logDescription.args.tokenOwner).to.eq(await creator.getAddress());
      expect(logDescription.args.tokenContract).to.eq(media.address);
    });
  });

  describe("#endAuction", () => {
    let auctionHouse: AuctionHouse;
    let admin: Signer;
    let creator: Signer;
    let curator: Signer;
    let bidder: Signer;
    let other: Signer;
    let badBidder: BadBidder;

    beforeEach(async () => {
      [admin, creator, curator, bidder, other] = await ethers.getSigners();
      auctionHouse = (await deploy()) as AuctionHouse;
      await mint(media.connect(creator));
      await approveAuction(media.connect(creator), auctionHouse);
      await createAuction(
        auctionHouse.connect(creator),
        await curator.getAddress()
      );
      await auctionHouse.connect(curator).setAuctionApproval(0, true);
      badBidder = await deployBidder(auctionHouse.address, media.address);
    });

    it("should revert if the auction does not exist", async () => {
      await expect(auctionHouse.endAuction(1110)).eventually.rejected;
    });

    it("should revert if the auction has not begun", async () => {
      await expect(auctionHouse.endAuction(0)).eventually.rejected;
    });

    it("should revert if the auction has not completed", async () => {
      await auctionHouse.createBid(0, ONE_ETH, {
        value: ONE_ETH,
      });

      await expect(auctionHouse.endAuction(0)).eventually.rejected;
    });

    it("should cancel the auction if the winning bidder is unable to receive NFTs", async () => {
      await badBidder.placeBid(0, TWO_ETH, { value: TWO_ETH });
      const endTime =
        (await auctionHouse.auctions(0)).duration.toNumber() +
        (await auctionHouse.auctions(0)).firstBidTime.toNumber();
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);

      await auctionHouse.endAuction(0);

      expect(await media.ownerOf(0)).to.eq(await creator.getAddress());
      expect(await ethers.provider.getBalance(badBidder.address)).to.eq(
        TWO_ETH
      );
    });

    describe("ETH auction", () => {
      beforeEach(async () => {
        await auctionHouse
          .connect(bidder)
          .createBid(0, ONE_ETH, { value: ONE_ETH });
        const endTime =
          (await auctionHouse.auctions(0)).duration.toNumber() +
          (await auctionHouse.auctions(0)).firstBidTime.toNumber();
        await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
      });

      it("should transfer the NFT to the winning bidder", async () => {
        await auctionHouse.endAuction(0);

        expect(await media.ownerOf(0)).to.eq(await bidder.getAddress());
      });

      it("should pay the curator their curatorFee percentage", async () => {
        const beforeBalance = await ethers.provider.getBalance(
          await curator.getAddress()
        );
        await auctionHouse.endAuction(0);
        const expectedCuratorFee = "42500000000000000";
        const curatorBalance = await ethers.provider.getBalance(
          await curator.getAddress()
        );
        await expect(curatorBalance.sub(beforeBalance).toString()).to.eq(
          expectedCuratorFee
        );
      });

      it("should pay the creator the remainder of the winning bid", async () => {
        const beforeBalance = await ethers.provider.getBalance(
          await creator.getAddress()
        );
        await auctionHouse.endAuction(0);
        const expectedProfit = "957500000000000000";
        const creatorBalance = await ethers.provider.getBalance(
          await creator.getAddress()
        );
        const wethBalance = await weth.balanceOf(await creator.getAddress());
        await expect(
          creatorBalance.sub(beforeBalance).add(wethBalance).toString()
        ).to.eq(expectedProfit);
      });

      it("should emit an AuctionEnded event", async () => {
        const block = await ethers.provider.getBlockNumber();
        const auctionData = await auctionHouse.auctions(0);
        await auctionHouse.endAuction(0);
        const events = await auctionHouse.queryFilter(
          auctionHouse.filters.AuctionEnded(
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null
          ),
          block
        );
        expect(events.length).eq(1);
        const logDescription = auctionHouse.interface.parseLog(events[0]);

        expect(logDescription.args.tokenId).to.eq(0);
        expect(logDescription.args.tokenOwner).to.eq(auctionData.tokenOwner);
        expect(logDescription.args.curator).to.eq(auctionData.curator);
        expect(logDescription.args.winner).to.eq(auctionData.bidder);
        expect(logDescription.args.amount.toString()).to.eq(
          "807500000000000000"
        );
        expect(logDescription.args.curatorFee.toString()).to.eq(
          "42500000000000000"
        );
        expect(logDescription.args.auctionCurrency).to.eq(weth.address);
      });

      it("should delete the auction", async () => {
        await auctionHouse.endAuction(0);

        const auctionResult = await auctionHouse.auctions(0);

        expect(auctionResult.amount.toNumber()).to.eq(0);
        expect(auctionResult.duration.toNumber()).to.eq(0);
        expect(auctionResult.firstBidTime.toNumber()).to.eq(0);
        expect(auctionResult.reservePrice.toNumber()).to.eq(0);
        expect(auctionResult.curatorFeePercentage).to.eq(0);
        expect(auctionResult.tokenOwner).to.eq(ethers.constants.AddressZero);
        expect(auctionResult.bidder).to.eq(ethers.constants.AddressZero);
        expect(auctionResult.curator).to.eq(ethers.constants.AddressZero);
        expect(auctionResult.auctionCurrency).to.eq(
          ethers.constants.AddressZero
        );
      });
    });
  });
});
