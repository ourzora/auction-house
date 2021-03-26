import chai, { expect } from "chai";
import asPromised from "chai-as-promised";
// @ts-ignore
import { ethers } from "hardhat";
import { Market, Media } from "@zoralabs/core/dist/typechain";
import { ReserveAuction, BadBidder } from "../typechain";
import { formatUnits } from "ethers/lib/utils";
import { BigNumber, Contract, Signer } from "ethers";
import {
  approveAuction,
  deployBidder,
  deployWETH,
  deployZoraProtocol,
  mint,
  ONE_ETH,
  revert,
  TWO_ETH,
} from "./utils";

chai.use(asPromised);

describe("ReserveAuction", () => {
  let market: Market;
  let media: Media;
  let weth: Contract;

  beforeEach(async () => {
    await ethers.provider.send("hardhat_reset", []);
    const contracts = await deployZoraProtocol();
    market = contracts.market;
    media = contracts.media;
    weth = await deployWETH();
  });

  async function deploy(): Promise<ReserveAuction> {
    const ReserveAuction = await ethers.getContractFactory("ReserveAuction");
    const impl = await ReserveAuction.deploy();
    const ZoraProxy = await ethers.getContractFactory("ZoraProxy");
    const [admin] = await ethers.getSigners();
    const proxy = await ZoraProxy.deploy(impl.address, admin.address);
    const auction = ReserveAuction.attach(proxy.address).connect(admin);
    await auction.configure(media.address, weth.address);

    return auction as ReserveAuction;
  }

  async function createAuction(
    auction: ReserveAuction,
    curator: string,
    currency = "0x0000000000000000000000000000000000000000"
  ) {
    const tokenId = 0;
    const duration = 60 * 60 * 24;
    const reservePrice = BigNumber.from(10).pow(18).div(2);
    const owner = await media.ownerOf(0);

    await auction.createAuction(
      tokenId,
      duration,
      reservePrice,
      owner,
      curator,
      5,
      currency
    );
  }

  describe("#constructor", () => {
    it("should be able to deploy", async () => {
      const ReserveAuction = await ethers.getContractFactory("ReserveAuction");
      const impl = await ReserveAuction.deploy();
      const ZoraProxy = await ethers.getContractFactory("ZoraProxy");
      const [admin] = await ethers.getSigners();
      const proxy = await ZoraProxy.deploy(impl.address, admin.address);
      const auction = ReserveAuction.attach(proxy.address).connect(admin);
      await auction.configure(media.address, weth.address);

      expect(await auction.zora()).to.eq(
        media.address,
        "incorrect zora address"
      );
      expect(await auction.admin()).to.eq(admin.address, "incorrect owner");
      expect(await auction.paused()).to.eq(
        false,
        "auction should not be paused"
      );
      expect(formatUnits(await auction.timeBuffer(), 0)).to.eq(
        "900.0",
        "time buffer should equal 900"
      );
      expect(await auction.minBidIncrementPercentage()).to.eq(
        10,
        "minBidIncrementPercentage should equal 10%"
      );
    });

    it("should not allow a configuration address that is not the Zora Media Protocol", async () => {
      const ReserveAuction = await ethers.getContractFactory("ReserveAuction");
      const impl = await ReserveAuction.deploy();
      const ZoraProxy = await ethers.getContractFactory("ZoraProxy");
      const [admin] = await ethers.getSigners();
      const proxy = await ZoraProxy.deploy(impl.address, admin.address);
      const auction = ReserveAuction.attach(proxy.address).connect(admin);
      await expect(
        auction.configure(market.address, weth.address)
      ).eventually.rejectedWith("Transaction reverted without a reason");
    });
  });

  describe("#createAuction", () => {
    let auction: ReserveAuction;
    beforeEach(async () => {
      auction = await deploy();
      await mint(media);
      await approveAuction(media, auction);
    });

    it("should revert if the auction is paused", async () => {
      await auction.updatePaused(true);
      const tokenId = 0;
      const duration = 60 * 60 * 24;
      const reservePrice = BigNumber.from(10).pow(18).div(2);
      const owner = await media.ownerOf(0);
      const [_, curator] = await ethers.getSigners();

      await expect(
        auction.createAuction(
          tokenId,
          duration,
          reservePrice,
          owner,
          curator.address,
          5,
          "0x0000000000000000000000000000000000000000"
        )
      ).eventually.rejectedWith(revert`Must not be paused`);
    });

    it("should revert if the token ID does not exist", async () => {
      const tokenId = 999;
      const duration = 60 * 60 * 24;
      const reservePrice = BigNumber.from(10).pow(18).div(2);
      const owner = await media.ownerOf(0);
      const [_, curator] = await ethers.getSigners();

      await expect(
        auction.createAuction(
          tokenId,
          duration,
          reservePrice,
          owner,
          curator.address,
          5,
          "0x0000000000000000000000000000000000000000"
        )
      ).eventually.rejectedWith(
        revert`ERC721: operator query for nonexistent token`
      );
    });

    it("should revert if the curator fee percentage is >= 100", async () => {
      const duration = 60 * 60 * 24;
      const reservePrice = BigNumber.from(10).pow(18).div(2);
      const owner = await media.ownerOf(0);
      const [_, curator] = await ethers.getSigners();

      await expect(
        auction.createAuction(
          0,
          duration,
          reservePrice,
          owner,
          curator.address,
          100,
          "0x0000000000000000000000000000000000000000"
        )
      ).eventually.rejectedWith(
        revert`curatorFeePercentage must be less than 100`
      );
    });

    it("should create an auction", async () => {
      const owner = await media.ownerOf(0);
      const [_, expectedCurator] = await ethers.getSigners();
      await createAuction(auction, await expectedCurator.getAddress());

      const createdAuction = await auction.auctions(0);

      expect(createdAuction.duration).to.eq(24 * 60 * 60);
      expect(createdAuction.reservePrice).to.eq(
        BigNumber.from(10).pow(18).div(2)
      );
      expect(createdAuction.curatorFeePercentage).to.eq(5);
      expect(createdAuction.creator).to.eq(owner);
      expect(createdAuction.curator).to.eq(expectedCurator.address);
      expect(createdAuction.approved).to.eq(false);
    });

    it("should be automatically approved if the creator is the curator", async () => {
      const owner = await media.ownerOf(0);
      await createAuction(auction, owner);

      const createdAuction = await auction.auctions(0);

      expect(createdAuction.approved).to.eq(true);
    });

    it("should be automatically approved if the creator is the Zero Address", async () => {
      await createAuction(auction, ethers.constants.AddressZero);

      const createdAuction = await auction.auctions(0);

      expect(createdAuction.approved).to.eq(true);
    });

    it("should emit an AuctionCreated event", async () => {
      const owner = await media.ownerOf(0);
      const [_, expectedCurator] = await ethers.getSigners();

      const block = await ethers.provider.getBlockNumber();
      await createAuction(auction, await expectedCurator.getAddress());
      const currAuction = await auction.auctions(0);
      const events = await auction.queryFilter(
        auction.filters.AuctionCreated(null, null, null, null, null, null),
        block
      );
      expect(events.length).eq(1);
      const logDescription = auction.interface.parseLog(events[0]);
      expect(logDescription.name).to.eq("AuctionCreated");
      expect(logDescription.args.duration).to.eq(currAuction.duration);
      expect(logDescription.args.reservePrice).to.eq(currAuction.reservePrice);
      expect(logDescription.args.creator).to.eq(currAuction.creator);
      expect(logDescription.args.curator).to.eq(currAuction.curator);
      expect(logDescription.args.curatorFeePercentage).to.eq(
        currAuction.curatorFeePercentage
      );
    });
  });

  describe("#setAuctionApproval", () => {
    let auction: ReserveAuction;
    let admin: Signer;
    let curator: Signer;
    let bidder: Signer;

    beforeEach(async () => {
      [admin, curator, bidder] = await ethers.getSigners();
      auction = (await deploy()).connect(curator) as ReserveAuction;
      await mint(media);
      await approveAuction(media, auction);
      await createAuction(auction, await curator.getAddress());
    });

    it("should revert if the contract is paused", async () => {
      await auction.connect(admin).updatePaused(true);
      await expect(auction.setAuctionApproval(0, true)).eventually.rejectedWith(
        revert`Must not be paused`
      );
    });

    it("should revert if the auction does not exist", async () => {
      await expect(
        auction.setAuctionApproval(1110, true)
      ).eventually.rejectedWith(revert`Auction doesn't exist`);
    });

    it("should revert if not called by the curator", async () => {
      await expect(
        auction.connect(admin).setAuctionApproval(0, true)
      ).eventually.rejectedWith(revert`Must be auction curator`);
    });

    it("should revert if the auction has already started", async () => {
      await auction.setAuctionApproval(0, true);
      await auction.connect(bidder).createBid(0, ONE_ETH, { value: ONE_ETH });
      await expect(
        auction.setAuctionApproval(0, false)
      ).eventually.rejectedWith(revert`Auction has already started`);
    });

    it("should set the auction as approved", async () => {
      await auction.setAuctionApproval(0, true);

      expect((await auction.auctions(0)).approved).to.eq(true);
    });

    it("should emit an AuctionApproved event", async () => {
      const block = await ethers.provider.getBlockNumber();
      await auction.setAuctionApproval(0, true);
      const events = await auction.queryFilter(
        auction.filters.AuctionApprovalUpdated(null, null),
        block
      );
      expect(events.length).eq(1);
      const logDescription = auction.interface.parseLog(events[0]);

      expect(logDescription.args.approved).to.eq(true);
    });
  });

  describe("#createBid", () => {
    let auction: ReserveAuction;
    let admin: Signer;
    let curator: Signer;
    let bidderA: Signer;
    let bidderB: Signer;

    beforeEach(async () => {
      [admin, curator, bidderA, bidderB] = await ethers.getSigners();
      auction = (await (await deploy()).connect(bidderA)) as ReserveAuction;
      await mint(media);
      await approveAuction(media, auction);
      await createAuction(auction, await curator.getAddress());
      await auction.connect(curator).setAuctionApproval(0, true);
    });

    it("should revert if the specified auction does not exist", async () => {
      await expect(auction.createBid(11111, ONE_ETH)).eventually.rejectedWith(
        revert`Auction doesn't exist`
      );
    });

    it("should revert if the specified auction is paused", async () => {
      await (await auction.connect(admin)).updatePaused(true);
      await expect(
        auction.createBid(0, ONE_ETH, { value: ONE_ETH })
      ).eventually.rejectedWith(revert`Must not be paused`);
    });

    it("should revert if the specified auction is not approved", async () => {
      await auction.connect(curator).setAuctionApproval(0, false);
      await expect(
        auction.createBid(0, ONE_ETH, { value: ONE_ETH })
      ).eventually.rejectedWith(revert`Auction must be approved by curator`);
    });

    it("should revert if the bid is less than the reserve price", async () => {
      await expect(
        auction.createBid(0, 0, { value: 0 })
      ).eventually.rejectedWith(revert`Must send at least reservePrice`);
    });

    it("should revert if the bid is invalid for share splitting", async () => {
      await expect(
        auction.createBid(0, ONE_ETH.add(1), { value: ONE_ETH.add(1) })
      ).eventually.rejectedWith(revert`Bid invalid for share splitting`);
    });

    it("should revert if msg.value does not equal specified amount", async () => {
      await expect(
        auction.createBid(0, ONE_ETH, { value: ONE_ETH.mul(2) })
      ).eventually.rejectedWith(
        revert`Sent ETH Value does not match specified bid amount`
      );
    });
    describe("first bid", () => {
      it("should set the first bid time", async () => {
        // TODO: Fix this test on Sun Oct 04 2274
        await ethers.provider.send("evm_setNextBlockTimestamp", [9617249934]);
        await auction.createBid(0, ONE_ETH, { value: ONE_ETH });
        expect((await auction.auctions(0)).firstBidTime).to.eq(9617249934);
      });

      it("should store the transferred ETH as WETH", async () => {
        await auction.createBid(0, ONE_ETH, { value: ONE_ETH });
        expect(await weth.balanceOf(auction.address)).to.eq(ONE_ETH);
      });

      it("should not update the auction's duration", async () => {
        const beforeDuration = (await auction.auctions(0)).duration;
        await auction.createBid(0, ONE_ETH, { value: ONE_ETH });
        const afterDuration = (await auction.auctions(0)).duration;

        expect(beforeDuration).to.eq(afterDuration);
      });

      it("should store the bidder's information", async () => {
        await auction.createBid(0, ONE_ETH, { value: ONE_ETH });
        const currAuction = await auction.auctions(0);

        expect(currAuction.bidder).to.eq(await bidderA.getAddress());
        expect(currAuction.amount).to.eq(ONE_ETH);
      });

      it("should emit an AuctionBid event", async () => {
        const block = await ethers.provider.getBlockNumber();
        await auction.createBid(0, ONE_ETH, { value: ONE_ETH });
        const events = await auction.queryFilter(
          auction.filters.AuctionBid(null, null, null, null, null),
          block
        );
        expect(events.length).eq(1);
        const logDescription = auction.interface.parseLog(events[0]);

        expect(logDescription.name).to.eq("AuctionBid");
        expect(logDescription.args.sender).to.eq(await bidderA.getAddress());
        expect(logDescription.args.value).to.eq(ONE_ETH);
        expect(logDescription.args.firstBid).to.eq(true);
        expect(logDescription.args.extended).to.eq(false);
      });
    });

    describe("second bid", () => {
      beforeEach(async () => {
        auction = auction.connect(bidderB) as ReserveAuction;
        await auction
          .connect(bidderA)
          .createBid(0, ONE_ETH, { value: ONE_ETH });
      });

      it("should revert if the bid is smaller than the last bid + minBid", async () => {
        await expect(
          auction.createBid(0, ONE_ETH.add(1), {
            value: ONE_ETH.add(1),
          })
        ).eventually.rejectedWith(
          revert`Must send more than last bid by minBidIncrementPercentage amount`
        );
      });

      it("should refund the previous bid", async () => {
        const beforeBalance = await ethers.provider.getBalance(
          await bidderA.getAddress()
        );
        const beforeBidAmount = (await auction.auctions(0)).amount;
        await auction.createBid(0, TWO_ETH, { value: TWO_ETH });
        const afterBalance = await ethers.provider.getBalance(
          await bidderA.getAddress()
        );

        expect(afterBalance).to.eq(beforeBalance.add(beforeBidAmount));
      });

      it("should not update the firstBidTime", async () => {
        const firstBidTime = (await auction.auctions(0)).firstBidTime;
        await auction.createBid(0, TWO_ETH, { value: TWO_ETH });
        expect((await auction.auctions(0)).firstBidTime).to.eq(firstBidTime);
      });

      it("should transfer the bid to the contract and store it as WETH", async () => {
        await auction.createBid(0, TWO_ETH, { value: TWO_ETH });

        expect(await weth.balanceOf(auction.address)).to.eq(TWO_ETH);
      });

      it("should update the stored bid information", async () => {
        await auction.createBid(0, TWO_ETH, { value: TWO_ETH });

        const currAuction = await auction.auctions(0);

        expect(currAuction.amount).to.eq(TWO_ETH);
        expect(currAuction.bidder).to.eq(await bidderB.getAddress());
      });

      it("should not extend the duration of the bid if outside of the time buffer", async () => {
        const beforeDuration = (await auction.auctions(0)).duration;
        await auction.createBid(0, TWO_ETH, { value: TWO_ETH });
        const afterDuration = (await auction.auctions(0)).duration;
        expect(beforeDuration).to.eq(afterDuration);
      });

      it("should emit an AuctionBid event", async () => {
        const block = await ethers.provider.getBlockNumber();
        await auction.createBid(0, TWO_ETH, { value: TWO_ETH });
        const events = await auction.queryFilter(
          auction.filters.AuctionBid(null, null, null, null, null),
          block
        );
        expect(events.length).eq(2);
        const logDescription = auction.interface.parseLog(events[1]);

        expect(logDescription.name).to.eq("AuctionBid");
        expect(logDescription.args.sender).to.eq(await bidderB.getAddress());
        expect(logDescription.args.value).to.eq(TWO_ETH);
        expect(logDescription.args.firstBid).to.eq(false);
        expect(logDescription.args.extended).to.eq(false);
      });

      describe("last minute bid", () => {
        beforeEach(async () => {
          const currAuction = await auction.auctions(0);
          await ethers.provider.send("evm_setNextBlockTimestamp", [
            currAuction.firstBidTime
              .add(currAuction.duration)
              .sub(1)
              .toNumber(),
          ]);
        });
        it("should extend the duration of the bid if inside of the time buffer", async () => {
          const beforeDuration = (await auction.auctions(0)).duration;
          await auction.createBid(0, TWO_ETH, { value: TWO_ETH });

          const currAuction = await auction.auctions(0);
          expect(currAuction.duration).to.eq(
            beforeDuration.add(await auction.timeBuffer())
          );
        });
        it("should emit an AuctionBid event", async () => {
          const block = await ethers.provider.getBlockNumber();
          await auction.createBid(0, TWO_ETH, { value: TWO_ETH });
          const events = await auction.queryFilter(
            auction.filters.AuctionBid(null, null, null, null, null),
            block
          );
          expect(events.length).eq(2);
          const logDescription = auction.interface.parseLog(events[1]);

          expect(logDescription.name).to.eq("AuctionBid");
          expect(logDescription.args.sender).to.eq(await bidderB.getAddress());
          expect(logDescription.args.value).to.eq(TWO_ETH);
          expect(logDescription.args.firstBid).to.eq(false);
          expect(logDescription.args.extended).to.eq(true);
        });
      });
      describe("late bid", () => {
        beforeEach(async () => {
          const currAuction = await auction.auctions(0);
          await ethers.provider.send("evm_setNextBlockTimestamp", [
            currAuction.firstBidTime
              .add(currAuction.duration)
              .add(1)
              .toNumber(),
          ]);
        });

        it("should revert if the bid is placed after expiry", async () => {
          await expect(
            auction.createBid(0, TWO_ETH, { value: TWO_ETH })
          ).eventually.rejectedWith(revert`Auction expired`);
        });
      });
    });
  });

  describe("#cancelAuction", () => {
    let auction: ReserveAuction;
    let admin: Signer;
    let creator: Signer;
    let curator: Signer;
    let bidder: Signer;

    beforeEach(async () => {
      [admin, creator, curator, bidder] = await ethers.getSigners();
      auction = (await deploy()).connect(creator) as ReserveAuction;
      await mint(media.connect(creator));
      await approveAuction(media.connect(creator), auction);
      await createAuction(auction, await curator.getAddress());
      await auction.connect(curator).setAuctionApproval(0, true);
    });

    it("should revert if the auction does not exist", async () => {
      await expect(auction.cancelAuction(12213)).eventually.rejectedWith(
        revert`Auction doesn't exist`
      );
    });

    it("should revert if not called by an admin, creator, or curator", async () => {
      await expect(
        auction.connect(bidder).cancelAuction(0)
      ).eventually.rejectedWith(
        `Can only be called by auction creator, admin, or curator`
      );
    });

    it("should revert if the auction has already begun", async () => {
      await auction.connect(bidder).createBid(0, ONE_ETH, { value: ONE_ETH });
      await expect(auction.cancelAuction(0)).eventually.rejectedWith(
        revert`Can't cancel an auction once it's begun`
      );
    });

    it("should be callable by the creator", async () => {
      await auction.cancelAuction(0);

      const auctionResult = await auction.auctions(0);

      expect(auctionResult.amount.toNumber()).to.eq(0);
      expect(auctionResult.duration.toNumber()).to.eq(0);
      expect(auctionResult.firstBidTime.toNumber()).to.eq(0);
      expect(auctionResult.reservePrice.toNumber()).to.eq(0);
      expect(auctionResult.curatorFeePercentage).to.eq(0);
      expect(auctionResult.creator).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.bidder).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.curator).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.auctionCurrency).to.eq(ethers.constants.AddressZero);

      expect(await media.ownerOf(0)).to.eq(await creator.getAddress());
    });

    it("should be callable by the curator", async () => {
      await auction.connect(admin).cancelAuction(0);

      const auctionResult = await auction.auctions(0);

      expect(auctionResult.amount.toNumber()).to.eq(0);
      expect(auctionResult.duration.toNumber()).to.eq(0);
      expect(auctionResult.firstBidTime.toNumber()).to.eq(0);
      expect(auctionResult.reservePrice.toNumber()).to.eq(0);
      expect(auctionResult.curatorFeePercentage).to.eq(0);
      expect(auctionResult.creator).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.bidder).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.curator).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.auctionCurrency).to.eq(ethers.constants.AddressZero);
      expect(await media.ownerOf(0)).to.eq(await creator.getAddress());
    });

    it("should be callable by the admin", async () => {
      await auction.connect(admin).cancelAuction(0);

      const auctionResult = await auction.auctions(0);

      expect(auctionResult.amount.toNumber()).to.eq(0);
      expect(auctionResult.duration.toNumber()).to.eq(0);
      expect(auctionResult.firstBidTime.toNumber()).to.eq(0);
      expect(auctionResult.reservePrice.toNumber()).to.eq(0);
      expect(auctionResult.curatorFeePercentage).to.eq(0);
      expect(auctionResult.creator).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.bidder).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.curator).to.eq(ethers.constants.AddressZero);
      expect(auctionResult.auctionCurrency).to.eq(ethers.constants.AddressZero);
      expect(await media.ownerOf(0)).to.eq(await creator.getAddress());
    });

    it("should emit an AuctionCanceled event", async () => {
      const block = await ethers.provider.getBlockNumber();
      await auction.cancelAuction(0);
      const events = await auction.queryFilter(
        auction.filters.AuctionCanceled(null, null),
        block
      );
      expect(events.length).eq(1);
      const logDescription = auction.interface.parseLog(events[0]);

      expect(logDescription.args.tokenId.toNumber()).to.eq(0);
      expect(logDescription.args.creator).to.eq(await creator.getAddress());
    });
  });

  describe("#endAuction", () => {
    let auction: ReserveAuction;
    let admin: Signer;
    let creator: Signer;
    let curator: Signer;
    let bidder: Signer;
    let other: Signer;
    let badBidder: BadBidder;

    beforeEach(async () => {
      [admin, creator, curator, bidder, other] = await ethers.getSigners();
      auction = (await deploy()) as ReserveAuction;
      await mint(media.connect(creator));
      await approveAuction(media.connect(creator), auction);
      await createAuction(auction.connect(creator), await curator.getAddress());
      await auction.connect(curator).setAuctionApproval(0, true);
      badBidder = await deployBidder(auction.address);
    });

    it("should revert if the auction is paused", async () => {
      await auction.connect(admin).updatePaused(true);

      await expect(auction.endAuction(0)).eventually.rejectedWith(
        revert`Must not be paused`
      );
    });

    it("should revert if the auction does not exist", async () => {
      await expect(auction.endAuction(1110)).eventually.rejectedWith(
        revert`Auction doesn't exist`
      );
    });

    it("should revert if the auction has not begun", async () => {
      await expect(auction.endAuction(0)).eventually.rejectedWith(
        revert`Auction hasn't begun`
      );
    });

    it("should revert if the auction has not completed", async () => {
      await auction.createBid(0, ONE_ETH, { value: ONE_ETH });

      await expect(auction.endAuction(0)).eventually.rejectedWith(
        revert`Auction hasn't completed`
      );
    });

    it("should cancel the auction if the winning bidder is unable to receive NFTs", async () => {
      await badBidder.placeBid(0, TWO_ETH, { value: TWO_ETH });
      const endTime =
        (await auction.auctions(0)).duration.toNumber() +
        (await auction.auctions(0)).firstBidTime.toNumber();
      await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);

      await auction.endAuction(0);

      expect(await media.ownerOf(0)).to.eq(await creator.getAddress());
      expect(await ethers.provider.getBalance(badBidder.address)).to.eq(
        TWO_ETH
      );
    });

    describe("ETH auction", () => {
      beforeEach(async () => {
        await auction.connect(bidder).createBid(0, ONE_ETH, { value: ONE_ETH });
        const endTime =
          (await auction.auctions(0)).duration.toNumber() +
          (await auction.auctions(0)).firstBidTime.toNumber();
        await ethers.provider.send("evm_setNextBlockTimestamp", [endTime + 1]);
      });

      it("should transfer the NFT to the winning bidder", async () => {
        await auction.endAuction(0);

        expect(await media.ownerOf(0)).to.eq(await bidder.getAddress());
      });

      it("should pay the curator their curatorFee percentage", async () => {
        const beforeBalance = await ethers.provider.getBalance(
          await curator.getAddress()
        );
        await auction.endAuction(0);
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
        await auction.endAuction(0);
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
        const auctionData = await auction.auctions(0);
        await auction.endAuction(0);
        const events = await auction.queryFilter(
          auction.filters.AuctionEnded(
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
        const logDescription = auction.interface.parseLog(events[0]);

        expect(logDescription.args.tokenId).to.eq(0);
        expect(logDescription.args.creator).to.eq(auctionData.creator);
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
        await auction.endAuction(0);

        const auctionResult = await auction.auctions(0);

        expect(auctionResult.amount.toNumber()).to.eq(0);
        expect(auctionResult.duration.toNumber()).to.eq(0);
        expect(auctionResult.firstBidTime.toNumber()).to.eq(0);
        expect(auctionResult.reservePrice.toNumber()).to.eq(0);
        expect(auctionResult.curatorFeePercentage).to.eq(0);
        expect(auctionResult.creator).to.eq(ethers.constants.AddressZero);
        expect(auctionResult.bidder).to.eq(ethers.constants.AddressZero);
        expect(auctionResult.curator).to.eq(ethers.constants.AddressZero);
        expect(auctionResult.auctionCurrency).to.eq(
          ethers.constants.AddressZero
        );
      });
    });
  });
});
