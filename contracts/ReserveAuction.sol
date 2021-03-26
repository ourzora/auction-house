// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.8;
pragma experimental ABIEncoderV2;

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { IERC721, IERC165 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IMarket, Decimal } from "@zoralabs/core/dist/contracts/interfaces/IMarket.sol";
import { IMedia } from "@zoralabs/core/dist/contracts/interfaces/IMedia.sol";
import { ZoraProxyStorage } from "./ZoraProxyStorage.sol";
import { ReserveAuctionStorageV1 } from "./ReserveAuctionStorageV1.sol";
import { IReserveAuction } from "./interfaces/IReserveAuction.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint wad) external;

    function transfer(address to, uint256 value) external returns (bool);
}

interface IMediaExtended is IMedia {
    function marketContract() external returns(address);
}

/**
 * @title An open reserve auction factory, enabling collectors and curators to run their own auctions
 */
contract ReserveAuction is ZoraProxyStorage, ReserveAuctionStorageV1, IReserveAuction, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /**
     * @notice Require that this contract is not paused
     */
    modifier notPaused() {
        require(!paused, "Must not be paused");
        _;
    }

    /**
     * @notice Require that the specified auction exists
     */
    modifier auctionExists(uint256 tokenId) {
        require(_exists(tokenId), "Auction doesn't exist");
        _;
    }

    /**
     * @notice Configure the auction.
     * @dev We use this function in lieu of a constructor in the event that
     * there is a critical flaw in this contract and it must be upgraded.
     * Note that the admin keys required to update the implementation should be
     * burned shortly after this contract is deployed.
     */
    function configure(address _zora, address _weth) public onlyAdmin {
        require(
            IERC165(_zora).supportsInterface(interfaceId),
            "Doesn't support NFT interface"
        );
        zora = _zora;
        wethAddress = _weth;
        timeBuffer = 15 * 60; // extend 15 minutes after every bid made in last 15 minutes
        minBidIncrementPercentage = 10; // 10%
    }

    /**
     * @notice Pause or unpause all auctions.
     * @dev This function should be inaccessible once the admin key is burned.
     */
    function updatePaused(bool _paused) public override onlyAdmin {
        paused = _paused;
    }

    /**
     * @notice Create an auction.
     * @dev Store the auction details in the auctions mapping and emit an AuctionCreated event.
     * If there is no curator, or if the curator is the auction creator, automatically approve the auction.
     */
    function createAuction(
        uint256 tokenId,
        uint256 duration,
        uint256 reservePrice,
        address payable creator,
        address payable curator,
        uint8 curatorFeePercentage,
        address auctionCurrency
    ) public override notPaused nonReentrant {
        require(!_exists(tokenId), "Auction already exists");
        require(curatorFeePercentage < 100, "curatorFeePercentage must be less than 100");
        auctions[tokenId].duration = duration;
        auctions[tokenId].reservePrice = reservePrice;
        auctions[tokenId].creator = creator;
        auctions[tokenId].curator = curator;
        auctions[tokenId].curatorFeePercentage = curatorFeePercentage;
        auctions[tokenId].auctionCurrency = auctionCurrency;

        IERC721(zora).transferFrom(creator, address(this), tokenId);

        emit AuctionCreated(tokenId, duration, reservePrice, creator, curator, curatorFeePercentage);

        if(auctions[tokenId].curator == address(0) || auctions[tokenId].curator == creator) {
            _approveAuction(tokenId, true);
        }
    }

    /**
     * @notice Approve an auction, opening up the auction for bids.
     * @dev Only callable by the curator. Cannot be called if the auction has already started.
     */
    function setAuctionApproval(uint256 tokenId, bool approved) external notPaused auctionExists(tokenId) {
        require(msg.sender == auctions[tokenId].curator, "Must be auction curator");
        require(auctions[tokenId].firstBidTime == 0, "Auction has already started");
        _approveAuction(tokenId, approved);
    }

    /**
     * @notice Create a bid on a token, with a given amount.
     * @dev If provided a valid bid, transfers the provided amount to this contract.
     * If the auction is run in native ETH, the ETH is wrapped so it can be identically to other
     * auction currencies in this contract.
     */
    function createBid(uint256 tokenId, uint256 amount)
    external
    override
    payable
    notPaused
    auctionExists(tokenId)
    nonReentrant
    {
        address payable lastBidder = auctions[tokenId].bidder;
        uint256 lastBidAmount = auctions[tokenId].amount;
        require(auctions[tokenId].approved, "Auction must be approved by curator");
        require(
            auctions[tokenId].firstBidTime == 0 ||
            block.timestamp <
            auctions[tokenId].firstBidTime + auctions[tokenId].duration,
            "Auction expired"
        );
        require(
            amount >= auctions[tokenId].reservePrice,
                "Must send at least reservePrice"
        );
        require(
            amount >= auctions[tokenId].amount.add(
                auctions[tokenId].amount.mul(minBidIncrementPercentage).div(100)
            ),
            "Must send more than last bid by minBidIncrementPercentage amount"
        );
        require(
            IMarket(IMediaExtended(zora).marketContract()).isValidBid(
                tokenId,
                amount
            ),
            "Bid invalid for share splitting"
        );

        // If this is the first valid bid, we should set the starting time now.
        // If it's not, then we should refund the last bidder
        if(auctions[tokenId].firstBidTime == 0) {
            auctions[tokenId].firstBidTime = block.timestamp;
        } else if(lastBidder != address(0)) {
            _handleOutgoingBid(lastBidder, lastBidAmount, auctions[tokenId].auctionCurrency);
        }

        _handleIncomingBid(amount, auctions[tokenId].auctionCurrency);

        auctions[tokenId].amount = amount;
        auctions[tokenId].bidder = msg.sender;


        bool extended = false;
        // at this point we know that the timestamp is less than start + duration (since the auction would be over, otherwise)
        // we want to know by how much the timestamp is less than start + duration
        // if the difference is less than the timeBuffer, increase the duration by the timeBuffer
        if (
            auctions[tokenId].firstBidTime.add(auctions[tokenId].duration).sub(
                block.timestamp
            ) < timeBuffer
        ) {
            auctions[tokenId].duration += timeBuffer;
            extended = true;
        }

        emit AuctionBid(
            tokenId,
            msg.sender,
            amount,
            lastBidder == address(0), // firstBid boolean
            extended
        );
    }

    /**
     * @notice End an auction, finalizing the bid on Zora and paying out the respective parties.
     * @dev If for some reason the bid cannot be placed on Zora (invalid bid shares, for example),
     * The auction is reset and the NFT is transferred back to the auction creator.
     */
    function endAuction(uint256 tokenId) external override notPaused auctionExists(tokenId) nonReentrant {
        require(
            uint256(auctions[tokenId].firstBidTime) != 0,
            "Auction hasn't begun"
        );
        require(
            block.timestamp >=
            auctions[tokenId].firstBidTime + auctions[tokenId].duration,
            "Auction hasn't completed"
        );

        address currency = auctions[tokenId].auctionCurrency == address(0) ? wethAddress : auctions[tokenId].auctionCurrency;
        uint256 curatorFee = 0;


        IMarket.Bid memory bid = IMarket.Bid({
            amount: auctions[tokenId].amount,
            currency: currency,
            bidder: address(this),
            recipient: auctions[tokenId].bidder,
            sellOnShare: Decimal.D256(0)
        });


        IERC20(currency).approve(IMediaExtended(zora).marketContract(), bid.amount);
        IMedia(zora).setBid(tokenId, bid);
        uint256 beforeBalance = IERC20(currency).balanceOf(address(this));
        try IMedia(zora).acceptBid(tokenId, bid) {} catch {
            // If the underlying NFT transfer here fails, we should cancel the auction and refund the winner
            IMediaExtended(zora).removeBid(tokenId);
            _handleOutgoingBid(auctions[tokenId].bidder, auctions[tokenId].amount, auctions[tokenId].auctionCurrency);
            _cancelAuction(tokenId);
            return;
        }
        uint256 afterBalance = IERC20(currency).balanceOf(address(this));

        // We have to calculate the amount to send to the token owner here in case there was a
        // sell-on share on the token
        uint256 creatorProfit = afterBalance.sub(beforeBalance);

        if(auctions[tokenId].curator != address(0)) {
            curatorFee = creatorProfit.mul(auctions[tokenId].curatorFeePercentage).div(100);
            creatorProfit = creatorProfit.sub(curatorFee);
            _handleOutgoingBid(auctions[tokenId].curator, curatorFee, auctions[tokenId].auctionCurrency);
        }
        _handleOutgoingBid(auctions[tokenId].creator, creatorProfit, auctions[tokenId].auctionCurrency);

        emit AuctionEnded(
            tokenId,
            auctions[tokenId].creator,
            auctions[tokenId].curator,
            auctions[tokenId].bidder,
            creatorProfit,
            curatorFee,
            currency
        );
        delete auctions[tokenId];
    }

    /**
     * @notice Cancel an auction.
     * @dev Transfers the NFT back to the auction creator and emits an AuctionCanceled event
     */
    function cancelAuction(uint256 tokenId) external override nonReentrant auctionExists(tokenId) {
        require(
            auctions[tokenId].creator == msg.sender || msg.sender == admin,
            "Can only be called by auction creator, admin, or curator"
        );
        require(
            uint256(auctions[tokenId].firstBidTime) == 0,
            "Can't cancel an auction once it's begun"
        );
        _cancelAuction(tokenId);
    }

    /**
     * @dev Given an amount and a currency, transfer the currency to this contract.
     * If the currency is ETH (0x0), attempt to wrap the amount as WETH
     */
    function _handleIncomingBid(uint256 amount, address currency) internal {
        // If this is an ETH bid, ensure they sent enough and convert it to WETH under the hood
        if(currency == address(0)) {
            require(msg.value == amount, "Sent ETH Value does not match specified bid amount");
            IWETH(wethAddress).deposit{value: amount}();
        } else {
            // We must check the balance that was actually transferred to the auction,
            // as some tokens impose a transfer fee and would not actually transfer the
            // full amount to the market, resulting in potentally locked funds
            IERC20 token = IERC20(currency);
            uint256 beforeBalance = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), amount);
            uint256 afterBalance = token.balanceOf(address(this));
            require(beforeBalance.add(amount) == afterBalance, "Token transfer call did not transfer expected amount");
        }
    }

    function _handleOutgoingBid(address payable to, uint256 amount, address currency) internal {
        // If the auction is in ETH, unwrap it from its underlying WETH and try to send it to the recipient.
        if(currency == address(0)) {
            IWETH(wethAddress).withdraw(amount);

            // If the ETH transfer fails (sigh), rewrap the ETH and try send it as WETH.
            if(!_safeTransferETH(to, amount)) {
                IWETH(wethAddress).deposit{value: amount}();
                IERC20(wethAddress).safeTransfer(to, amount);
            }
        } else {
            IERC20(currency).safeTransfer(to, amount);
        }
    }

    function _safeTransferETH(address to, uint256 value) internal returns (bool) {
        (bool success, ) = to.call{value: value}(new bytes(0));
        return success;
    }

    function _cancelAuction(uint256 tokenId) internal {
        address creator = auctions[tokenId].creator;
        IERC721(zora).safeTransferFrom(address(this), creator, tokenId);

        delete auctions[tokenId];
        emit AuctionCanceled(tokenId, creator);
    }

    function _approveAuction(uint256 tokenId, bool approved) internal {
        auctions[tokenId].approved = approved;
        emit AuctionApprovalUpdated(tokenId, approved);
    }

    function _exists(uint256 tokenId) internal returns(bool) {
        return auctions[tokenId].creator != address(0);
    }

    // TODO: consider reverting if the message sender is not WETH
    receive() external payable {}
    fallback() external payable {}
}