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
import { IAuctionHouse } from "./interfaces/IAuctionHouse.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint wad) external;

    function transfer(address to, uint256 value) external returns (bool);
}

interface IMediaExtended is IMedia {
    function marketContract() external returns(address);
}

/**
 * @title An open auction house, enabling collectors and curators to run their own auctions
 */
contract AuctionHouse is IAuctionHouse, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // The minimum amount of time left in an auction after a new bid is created
    uint256 public timeBuffer;

    // The minimum percentage difference between the last bid amount and the current bid.
    uint8 public minBidIncrementPercentage;

    // The address of the zora protocol to use via this contract
    address public zora;

    // / The address of the WETH contract, so that any ETH transferred can be handled as an ERC-20
    address public wethAddress;

    // A mapping of all of the auctions currently running.
    mapping(address => mapping(uint256 => IAuctionHouse.Auction)) public auctions;

    bytes4 constant interfaceId = 0x80ac58cd; // 721 interface id

    /**
     * @notice Require that the specified auction exists
     */
    modifier auctionExists(address tokenContract, uint256 tokenId) {
        require(_exists(tokenContract, tokenId), "Auction doesn't exist");
        _;
    }

    /*
     * Constructor
     */
    constructor(address _zora, address _weth) public {
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
     * @notice Create an auction.
     * @dev Store the auction details in the auctions mapping and emit an AuctionCreated event.
     * If there is no curator, or if the curator is the auction creator, automatically approve the auction.
     */
    function createAuction(
        uint256 tokenId,
        address tokenContract,
        uint256 duration,
        uint256 reservePrice,
        address payable curator,
        uint8 curatorFeePercentage,
        address auctionCurrency
    ) public override nonReentrant {
        require(
            IERC165(tokenContract).supportsInterface(interfaceId),
            "tokenContract does not support ERC721 interface"
        );
        require(!_exists(tokenContract, tokenId), "Auction already exists");
        require(curatorFeePercentage < 100, "curatorFeePercentage must be less than 100");
        address tokenOwner = IERC721(tokenContract).ownerOf(tokenId);
        require(msg.sender == IERC721(tokenContract).getApproved(tokenId) || msg.sender == tokenOwner, "Caller must be approved or owner for token id");

        auctions[tokenContract][tokenId] = Auction({
            approved: false,
            amount: 0,
            duration: duration,
            firstBidTime: 0,
            reservePrice: reservePrice,
            curatorFeePercentage: curatorFeePercentage,
            tokenOwner: tokenOwner,
            bidder: address(0),
            curator: curator,
            auctionCurrency: auctionCurrency
        });

        IERC721(tokenContract).transferFrom(tokenOwner, address(this), tokenId);

        emit AuctionCreated(tokenId, tokenContract, duration, reservePrice, tokenOwner, curator, curatorFeePercentage, auctionCurrency);

        if(auctions[tokenContract][tokenId].curator == address(0) || auctions[tokenContract][tokenId].curator == tokenOwner) {
            _approveAuction(tokenContract, tokenId, true);
        }
    }

    /**
     * @notice Approve an auction, opening up the auction for bids.
     * @dev Only callable by the curator. Cannot be called if the auction has already started.
     */
    function setAuctionApproval(address tokenContract, uint256 tokenId, bool approved) external override auctionExists(tokenContract, tokenId) {
        require(msg.sender == auctions[tokenContract][tokenId].curator, "Must be auction curator");
        require(auctions[tokenContract][tokenId].firstBidTime == 0, "Auction has already started");
        _approveAuction(tokenContract, tokenId, approved);
    }

    /**
     * @notice Create a bid on a token, with a given amount.
     * @dev If provided a valid bid, transfers the provided amount to this contract.
     * If the auction is run in native ETH, the ETH is wrapped so it can be identically to other
     * auction currencies in this contract.
     */
    function createBid(address tokenContract, uint256 tokenId, uint256 amount)
    external
    override
    payable
    auctionExists(tokenContract, tokenId)
    nonReentrant
    {
        address payable lastBidder = auctions[tokenContract][tokenId].bidder;
        uint256 lastBidAmount = auctions[tokenContract][tokenId].amount;
        require(auctions[tokenContract][tokenId].approved, "Auction must be approved by curator");
        require(
            auctions[tokenContract][tokenId].firstBidTime == 0 ||
            block.timestamp <
            auctions[tokenContract][tokenId].firstBidTime + auctions[tokenContract][tokenId].duration,
            "Auction expired"
        );
        require(
            amount >= auctions[tokenContract][tokenId].reservePrice,
                "Must send at least reservePrice"
        );
        require(
            amount >= auctions[tokenContract][tokenId].amount.add(
                auctions[tokenContract][tokenId].amount.mul(minBidIncrementPercentage).div(100)
            ),
            "Must send more than last bid by minBidIncrementPercentage amount"
        );

        // For Zora Protocol, ensure that the bid is valid for the current bidShare configuration
        if(tokenContract == zora) {
            require(
                IMarket(IMediaExtended(zora).marketContract()).isValidBid(
                    tokenId,
                    amount
                ),
                "Bid invalid for share splitting"
            );
        }

        // If this is the first valid bid, we should set the starting time now.
        // If it's not, then we should refund the last bidder
        if(auctions[tokenContract][tokenId].firstBidTime == 0) {
            auctions[tokenContract][tokenId].firstBidTime = block.timestamp;
        } else if(lastBidder != address(0)) {
            _handleOutgoingBid(lastBidder, lastBidAmount, auctions[tokenContract][tokenId].auctionCurrency);
        }

        _handleIncomingBid(amount, auctions[tokenContract][tokenId].auctionCurrency);

        auctions[tokenContract][tokenId].amount = amount;
        auctions[tokenContract][tokenId].bidder = msg.sender;


        bool extended = false;
        // at this point we know that the timestamp is less than start + duration (since the auction would be over, otherwise)
        // we want to know by how much the timestamp is less than start + duration
        // if the difference is less than the timeBuffer, increase the duration by the timeBuffer
        if (
            auctions[tokenContract][tokenId].firstBidTime.add(auctions[tokenContract][tokenId].duration).sub(
                block.timestamp
            ) < timeBuffer
        ) {
            auctions[tokenContract][tokenId].duration += timeBuffer;
            extended = true;
        }

        emit AuctionBid(
            tokenId,
            tokenContract,
            msg.sender,
            amount,
            lastBidder == address(0), // firstBid boolean
            extended
        );
    }

    /**
     * @notice End an auction, finalizing the bid on Zora if applicable and paying out the respective parties.
     * @dev If for some reason the auction cannot be finalized (invalid token recipient, for example),
     * The auction is reset and the NFT is transferred back to the auction creator.
     */
    function endAuction(address tokenContract, uint256 tokenId) external override auctionExists(tokenContract, tokenId) nonReentrant {
        require(
            uint256(auctions[tokenContract][tokenId].firstBidTime) != 0,
            "Auction hasn't begun"
        );
        require(
            block.timestamp >=
            auctions[tokenContract][tokenId].firstBidTime + auctions[tokenContract][tokenId].duration,
            "Auction hasn't completed"
        );

        address currency = auctions[tokenContract][tokenId].auctionCurrency == address(0) ? wethAddress : auctions[tokenContract][tokenId].auctionCurrency;
        uint256 curatorFee = 0;

        uint256 tokenOwnerProfit = auctions[tokenContract][tokenId].amount;

        if(tokenContract == zora) {
            // If the auction is running on zora, settle it on the protocol
            (bool success, uint256 remainingProfit) = _handleZoraAuctionSettlement(tokenContract, tokenId);
            tokenOwnerProfit = remainingProfit;
            if(success != true) {
                _handleOutgoingBid(auctions[tokenContract][tokenId].bidder, auctions[tokenContract][tokenId].amount, auctions[tokenContract][tokenId].auctionCurrency);
                _cancelAuction(tokenContract, tokenId);
                return;
            }
        } else {
            // Otherwise, transfer the token to the winner and pay out the participants below
            try IERC721(tokenContract).safeTransferFrom(address(this), auctions[tokenContract][tokenId].bidder, tokenId) {} catch {
                _handleOutgoingBid(auctions[tokenContract][tokenId].bidder, auctions[tokenContract][tokenId].amount, auctions[tokenContract][tokenId].auctionCurrency);
                _cancelAuction(tokenContract, tokenId);
                return;
            }
        }


        if(auctions[tokenContract][tokenId].curator != address(0)) {
            curatorFee = tokenOwnerProfit.mul(auctions[tokenContract][tokenId].curatorFeePercentage).div(100);
            tokenOwnerProfit = tokenOwnerProfit.sub(curatorFee);
            _handleOutgoingBid(auctions[tokenContract][tokenId].curator, curatorFee, auctions[tokenContract][tokenId].auctionCurrency);
        }
        _handleOutgoingBid(auctions[tokenContract][tokenId].tokenOwner, tokenOwnerProfit, auctions[tokenContract][tokenId].auctionCurrency);

        emit AuctionEnded(
            tokenId,
            tokenContract,
            auctions[tokenContract][tokenId].tokenOwner,
            auctions[tokenContract][tokenId].curator,
            auctions[tokenContract][tokenId].bidder,
            tokenOwnerProfit,
            curatorFee,
            currency
        );
        delete auctions[tokenContract][tokenId];
    }

    /**
     * @notice Cancel an auction.
     * @dev Transfers the NFT back to the auction creator and emits an AuctionCanceled event
     */
    function cancelAuction(address tokenContract, uint256 tokenId) external override nonReentrant auctionExists(tokenContract, tokenId) {
        require(
            auctions[tokenContract][tokenId].tokenOwner == msg.sender || auctions[tokenContract][tokenId].curator == msg.sender,
            "Can only be called by auction creator or curator"
        );
        require(
            uint256(auctions[tokenContract][tokenId].firstBidTime) == 0,
            "Can't cancel an auction once it's begun"
        );
        _cancelAuction(tokenContract, tokenId);
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

    function _handleOutgoingBid(address to, uint256 amount, address currency) internal {
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

    function _cancelAuction(address tokenContract, uint256 tokenId) internal {
        address tokenOwner = auctions[tokenContract][tokenId].tokenOwner;
        IERC721(tokenContract).safeTransferFrom(address(this), tokenOwner, tokenId);

        delete auctions[tokenContract][tokenId];
        emit AuctionCanceled(tokenId, tokenContract, tokenOwner);
    }

    function _approveAuction(address tokenContract, uint256 tokenId, bool approved) internal {
        auctions[tokenContract][tokenId].approved = approved;
        emit AuctionApprovalUpdated(tokenId, tokenContract, approved);
    }

    function _exists(address tokenContract, uint256 tokenId) internal returns(bool) {
        return auctions[tokenContract][tokenId].tokenOwner != address(0);
    }

    function _handleZoraAuctionSettlement(address tokenContract, uint256 tokenId) internal returns (bool, uint256) {
        address currency = auctions[tokenContract][tokenId].auctionCurrency == address(0) ? wethAddress : auctions[tokenContract][tokenId].auctionCurrency;

        IMarket.Bid memory bid = IMarket.Bid({
            amount: auctions[tokenContract][tokenId].amount,
            currency: currency,
            bidder: address(this),
            recipient: auctions[tokenContract][tokenId].bidder,
            sellOnShare: Decimal.D256(0)
        });

        IERC20(currency).approve(IMediaExtended(zora).marketContract(), bid.amount);
        IMedia(zora).setBid(tokenId, bid);
        uint256 beforeBalance = IERC20(currency).balanceOf(address(this));
        try IMedia(zora).acceptBid(tokenId, bid) {} catch {
            // If the underlying NFT transfer here fails, we should cancel the auction and refund the winner
            IMediaExtended(zora).removeBid(tokenId);
            return (false, 0);
        }
        uint256 afterBalance = IERC20(currency).balanceOf(address(this));

        // We have to calculate the amount to send to the token owner here in case there was a
        // sell-on share on the token
        return (true, afterBalance.sub(beforeBalance));
    }

    // TODO: consider reverting if the message sender is not WETH
    receive() external payable {}
    fallback() external payable {}
}