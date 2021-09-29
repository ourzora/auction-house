// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.6.8;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC721, IERC165} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
//import {IMarket, Decimal} from "@zoralabs/core/dist/contracts/interfaces/IMarket.sol";
//import {IMedia} from "@zoralabs/core/dist/contracts/interfaces/IMedia.sol";
import {IAuctionHouse, TimeExtension} from "./interfaces/IAuctionHouse.sol";

interface IWETH {
    function deposit() external payable;

    function withdraw(uint256 wad) external;

    function transfer(address to, uint256 value) external returns (bool);
}

interface IERC2981 is IERC165 {
    /// ERC165 bytes to add to interface array - set in parent contract
    /// implementing this standard
    ///
    /// bytes4(keccak256("royaltyInfo(uint256,uint256)")) == 0x2a55205a
    /// bytes4 private constant _INTERFACE_ID_ERC2981 = 0x2a55205a;
    /// _registerInterface(_INTERFACE_ID_ERC2981);

    /// @notice Called with the sale price to determine how much royalty
    //          is owed and to whom.
    /// @param _tokenId - the NFT asset queried for royalty information
    /// @param _salePrice - the sale price of the NFT asset specified by _tokenId
    /// @return receiver - address of who should be sent the royalty payment
    /// @return royaltyAmount - the royalty payment amount for _salePrice
    function royaltyInfo(
        uint256 _tokenId,
        uint256 _salePrice
    ) external view returns (
        address receiver,
        uint256 royaltyAmount
    );
}


/**
 * @title An open auction house, enabling collectors and curators to run their own auctions
 */
contract AuctionHouse is IAuctionHouse, ReentrancyGuard {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Counters for Counters.Counter;

    event RoyaltyPaid(address indexed to, uint amount);

    // The minimum amount of time left in an auction after a new bid is created
    uint256 public timeBuffer;

    // The minimum percentage difference between the last bid amount and the current bid.
    uint8 public minBidIncrementPercentage;


    // / The address of the WETH contract, so that any ETH transferred can be handled as an ERC-20
    address public wethAddress;

    // A mapping of all of the auctions currently running.
    mapping(uint256 => IAuctionHouse.Auction) idToAuction;
    // maps hash(address tokenContract, uint tokenid) to auctionId
    mapping(bytes32 => uint) tokenToAuctionId;

    bytes4 constant interfaceId = 0x80ac58cd; // 721 interface id
    bytes4 private constant _INTERFACE_ID_ERC2981 = 0x2a55205a;
    
    Counters.Counter private _auctionIdTracker;

    /**
     * @notice Require that the specified auction exists
     */
    modifier auctionExists(uint256 auctionId) {
        require(_exists(auctionId), "Auction doesn't exist");
        _;
    }

    function auctionId(address tokenContract, uint tokenId) public view returns (uint) {
        return tokenToAuctionId[keccak256(abi.encodePacked(tokenContract, tokenId))];
    }

    function auctions(uint256 auctionId)
        public
        view
        returns (IAuctionHouse.Auction memory)
    {
        return idToAuction[auctionId];
    }

    /*
     * Constructor
     */
    constructor(address _weth) public {
        wethAddress = _weth;
        timeBuffer = 15 * 60; // extend 15 minutes after every bid made in last 15 minutes
        minBidIncrementPercentage = 5; // 5%
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
        address auctionCurrency,
        uint256 buyItNowPrice
    ) public override nonReentrant returns (uint256) {
        require(
            IERC165(tokenContract).supportsInterface(interfaceId),
            "tokenContract does not support ERC721 interface"
        );
        require(
            curatorFeePercentage < 100,
            "curatorFeePercentage must be less than 100"
        );
        address tokenOwner = IERC721(tokenContract).ownerOf(tokenId);
        require(
            msg.sender == IERC721(tokenContract).getApproved(tokenId) ||
                msg.sender == tokenOwner,
            "Caller must be approved or owner for token id"
        );
        uint256 auctionId = _auctionIdTracker.current();

        idToAuction[auctionId] = Auction({
            tokenId: tokenId,
            tokenContract: tokenContract,
            approved: false,
            amount: 0,
            duration: duration,
            firstBidTime: 0,
            reservePrice: reservePrice,
            curatorFeePercentage: curatorFeePercentage,
            tokenOwner: tokenOwner,
            bidder: address(0),
            curator: curator,
            auctionCurrency: auctionCurrency,
            buyItNowPrice: buyItNowPrice
        });
        tokenToAuctionId[keccak256(abi.encodePacked(tokenContract, tokenId))] = auctionId;


        IERC721(tokenContract).transferFrom(tokenOwner, address(this), tokenId);

        _auctionIdTracker.increment();

        emit AuctionCreated(
            auctionId,
            tokenId,
            tokenContract,
            duration,
            reservePrice,
            tokenOwner,
            curator,
            curatorFeePercentage,
            auctionCurrency,
            buyItNowPrice
        );

        if (
            idToAuction[auctionId].curator == address(0) ||
            curator == tokenOwner
        ) {
            _approveAuction(auctionId, true);
        }

        return auctionId;
    }

    /**
     * @notice Approve an auction, opening up the auction for bids.
     * @dev Only callable by the curator. Cannot be called if the auction has already started.
     */
    function setAuctionApproval(uint256 auctionId, bool approved)
        external
        override
        auctionExists(auctionId)
    {
        require(
            msg.sender == idToAuction[auctionId].curator,
            "Must be auction curator"
        );
        require(
            idToAuction[auctionId].firstBidTime == 0,
            "Auction has already started"
        );
        _approveAuction(auctionId, approved);
    }

    function setAuctionReservePrice(uint256 auctionId, uint256 reservePrice)
        external
        override
        auctionExists(auctionId)
    {
        require(
            msg.sender == idToAuction[auctionId].curator ||
                msg.sender == idToAuction[auctionId].tokenOwner,
            "Must be auction curator or token owner"
        );
        require(
            idToAuction[auctionId].firstBidTime == 0,
            "Auction has already started"
        );

        idToAuction[auctionId].reservePrice = reservePrice;

        emit AuctionReservePriceUpdated(
            auctionId,
            idToAuction[auctionId].tokenId,
            idToAuction[auctionId].tokenContract,
            reservePrice
        );
    }

    /**
     * @notice Create a bid on a token, with a given amount.
     * @dev If provided a valid bid, transfers the provided amount to this contract.
     * If the auction is run in native ETH, the ETH is wrapped so it can be identically to other
     * auction currencies in this contract.
     */
    function createBid(uint256 auctionId, uint256 amount)
        external
        payable
        override
        auctionExists(auctionId)
        nonReentrant
    {
        address payable lastBidder = idToAuction[auctionId].bidder;
        require(
            idToAuction[auctionId].approved,
            "Auction must be approved by curator"
        );
        require(
            idToAuction[auctionId].firstBidTime == 0 ||
                block.timestamp <
                idToAuction[auctionId].firstBidTime.add(
                    idToAuction[auctionId].duration
                ),
            "Auction expired"
        );
        require(
            amount >= idToAuction[auctionId].reservePrice,
            "Must send at least reservePrice"
        );
        require(
            amount >=
                idToAuction[auctionId].amount.add(
                    idToAuction[auctionId]
                        .amount
                        .mul(minBidIncrementPercentage)
                        .div(100)
                ),
            "Must send more than last bid by minBidIncrementPercentage amount"
        );

        //zora specific code removed

        // If this is the first valid bid, we should set the starting time now.
        // If it's not, then we should refund the last bidder
        if (idToAuction[auctionId].firstBidTime == 0) {
            idToAuction[auctionId].firstBidTime = block.timestamp;
        } else if (lastBidder != address(0)) {
            _handleOutgoingBid(
                lastBidder,
                idToAuction[auctionId].amount,
                idToAuction[auctionId].auctionCurrency
            );
        }

        _handleIncomingBid(amount, idToAuction[auctionId].auctionCurrency);

        idToAuction[auctionId].amount = amount;
        idToAuction[auctionId].bidder = msg.sender;

        // at this point we know that the timestamp is less than start + duration (since the auction would be over, otherwise)
        // we want to know by how much the timestamp is less than start + duration
        // if the difference is less than the timeBuffer, increase the duration by the timeBuffer
        TimeExtension ext;
        if (
            idToAuction[auctionId].buyItNowPrice != 0 &&
            amount >= idToAuction[auctionId].buyItNowPrice
        ) {
            ext = TimeExtension.endedBuyItNow;
        }
        if (
            idToAuction[auctionId]
                .firstBidTime
                .add(idToAuction[auctionId].duration)
                .sub(block.timestamp) < timeBuffer
        ) {
            // Playing code golf for gas optimization:
            // uint256 expectedEnd = idToAuction[auctionId].firstBidTime.add(idToAuction[auctionId].duration);
            // uint256 timeRemaining = expectedEnd.sub(block.timestamp);
            // uint256 timeToAdd = timeBuffer.sub(timeRemaining);
            // uint256 newDuration = idToAuction[auctionId].duration.add(timeToAdd);
            uint256 oldDuration = idToAuction[auctionId].duration;
            idToAuction[auctionId].duration = oldDuration.add(
                timeBuffer.sub(
                    idToAuction[auctionId].firstBidTime.add(oldDuration).sub(
                        block.timestamp
                    )
                )
            );
            ext = TimeExtension.extended;
        }

        emit AuctionBid(
            auctionId,
            msg.sender,
            idToAuction[auctionId].tokenContract,
            idToAuction[auctionId].tokenId,
            amount,
            lastBidder == address(0), // firstBid boolean
            ext == TimeExtension.extended
        );

        if (ext == TimeExtension.endedBuyItNow) {
            _endAuction(auctionId);
        } else if (ext == TimeExtension.extended) {
            emit AuctionDurationExtended(
                auctionId,
                idToAuction[auctionId].tokenId,
                idToAuction[auctionId].tokenContract,
                idToAuction[auctionId].duration
            );
        }
    }

    /**
     * @notice End an auction, finalizing the bid on Zora if applicable and paying out the respective parties.
     * @dev If for some reason the auction cannot be finalized (invalid token recipient, for example),
     * The auction is reset and the NFT is transferred back to the auction creator.
     */
    function endAuction(uint256 auctionId)
        external
        override
        auctionExists(auctionId)
        nonReentrant
    {
        require(
            block.timestamp >=
                idToAuction[auctionId].firstBidTime.add(
                    idToAuction[auctionId].duration
                ),
            "Auction hasn't completed"
        );
        _endAuction(auctionId);
    }

    function _endAuction(uint256 auctionId) internal {
        require(
            uint256(idToAuction[auctionId].firstBidTime) != 0,
            "Auction hasn't begun"
        );

        address currency = idToAuction[auctionId].auctionCurrency == address(0)
            ? wethAddress
            : idToAuction[auctionId].auctionCurrency;
        uint256 curatorFee = 0;

        uint256 tokenOwnerProfit = idToAuction[auctionId].amount;

        //ZORA NFT specific code removed
        // Otherwise, transfer the token to the winner and pay out the participants below
        try
            IERC721(idToAuction[auctionId].tokenContract).safeTransferFrom(
                address(this),
                idToAuction[auctionId].bidder,
                idToAuction[auctionId].tokenId
            )
        {} catch {
            _handleOutgoingBid(
                idToAuction[auctionId].bidder,
                idToAuction[auctionId].amount,
                idToAuction[auctionId].auctionCurrency
            );
            _cancelAuction(auctionId);
            return;
        }

        if (idToAuction[auctionId].curator != address(0)) {
            curatorFee = tokenOwnerProfit
                .mul(idToAuction[auctionId].curatorFeePercentage)
                .div(100);
            tokenOwnerProfit = tokenOwnerProfit.sub(curatorFee);
            _handleOutgoingBid(
                idToAuction[auctionId].curator,
                curatorFee,
                idToAuction[auctionId].auctionCurrency
            );
        }

        if(IERC165(idToAuction[auctionId].tokenContract).supportsInterface(_INTERFACE_ID_ERC2981)) {
            (address royaltyRecip, uint royalty) = IERC2981(idToAuction[auctionId].tokenContract).royaltyInfo(idToAuction[auctionId].tokenId, tokenOwnerProfit);
            if(royalty > 0) {
                // this shouldnt happen with a properly designed token.
                // dont want to revert tho because that would make auction never end
                if(royalty > tokenOwnerProfit) royalty = tokenOwnerProfit;
                tokenOwnerProfit = tokenOwnerProfit.sub(royalty);
                _handleOutgoingBid(
                    royaltyRecip,
                    royalty,
                    idToAuction[auctionId].auctionCurrency
                );
                emit RoyaltyPaid(royaltyRecip, royalty);
            }
        }

        _handleOutgoingBid(
            idToAuction[auctionId].tokenOwner,
            tokenOwnerProfit,
            idToAuction[auctionId].auctionCurrency
        );

        emit AuctionEnded(
            auctionId,
            idToAuction[auctionId].tokenId,
            idToAuction[auctionId].tokenContract,
            idToAuction[auctionId].tokenOwner,
            idToAuction[auctionId].curator,
            idToAuction[auctionId].bidder,
            tokenOwnerProfit,
            curatorFee,
            currency
        );
        delete idToAuction[auctionId];
    }

    /**
     * @notice Cancel an auction.
     * @dev Transfers the NFT back to the auction creator and emits an AuctionCanceled event
     */
    function cancelAuction(uint256 auctionId)
        external
        override
        nonReentrant
        auctionExists(auctionId)
    {
        require(
            idToAuction[auctionId].tokenOwner == msg.sender ||
                idToAuction[auctionId].curator == msg.sender,
            "Can only be called by auction creator or curator"
        );
        require(
            uint256(idToAuction[auctionId].firstBidTime) == 0,
            "Can't cancel an auction once it's begun"
        );
        _cancelAuction(auctionId);
    }

    /**
     * @dev Given an amount and a currency, transfer the currency to this contract.
     * If the currency is ETH (0x0), attempt to wrap the amount as WETH
     */
    function _handleIncomingBid(uint256 amount, address currency) internal {
        if(amount == 0) return;
        // If this is an ETH bid, ensure they sent enough and convert it to WETH under the hood
        if (currency == address(0)) {
            require(
                msg.value == amount,
                "Sent ETH Value does not match specified bid amount"
            );
            IWETH(wethAddress).deposit{value: amount}();
        } else {
            // We must check the balance that was actually transferred to the auction,
            // as some tokens impose a transfer fee and would not actually transfer the
            // full amount to the market, resulting in potentally locked funds
            IERC20 token = IERC20(currency);
            uint256 beforeBalance = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), amount);
            uint256 afterBalance = token.balanceOf(address(this));
            require(
                beforeBalance.add(amount) == afterBalance,
                "Token transfer call did not transfer expected amount"
            );
        }
    }

    function _handleOutgoingBid(
        address to,
        uint256 amount,
        address currency
    ) internal {
        // If the auction is in ETH, unwrap it from its underlying WETH and try to send it to the recipient.
        if (currency == address(0)) {
            IWETH(wethAddress).withdraw(amount);

            // If the ETH transfer fails (sigh), rewrap the ETH and try send it as WETH.
            if (!_safeTransferETH(to, amount)) {
                IWETH(wethAddress).deposit{value: amount}();
                IERC20(wethAddress).safeTransfer(to, amount);
            }
        } else {
            IERC20(currency).safeTransfer(to, amount);
        }
    }

    function _safeTransferETH(address to, uint256 value)
        internal
        returns (bool)
    {
        (bool success, ) = to.call{value: value}(new bytes(0));
        return success;
    }

    function _cancelAuction(uint256 auctionId) internal {
        address tokenOwner = idToAuction[auctionId].tokenOwner;
        IERC721(idToAuction[auctionId].tokenContract).safeTransferFrom(
            address(this),
            tokenOwner,
            idToAuction[auctionId].tokenId
        );

        emit AuctionCanceled(
            auctionId,
            idToAuction[auctionId].tokenId,
            idToAuction[auctionId].tokenContract,
            tokenOwner
        );
        delete idToAuction[auctionId];
    }

    function _approveAuction(uint256 auctionId, bool approved) internal {
        idToAuction[auctionId].approved = approved;
        emit AuctionApprovalUpdated(
            auctionId,
            idToAuction[auctionId].tokenId,
            idToAuction[auctionId].tokenContract,
            approved
        );
    }

    function _exists(uint256 auctionId) internal view returns (bool) {
        return idToAuction[auctionId].tokenOwner != address(0);
    }


    // TODO: consider reverting if the message sender is not WETH
    receive() external payable {}

    fallback() external payable {}
}
