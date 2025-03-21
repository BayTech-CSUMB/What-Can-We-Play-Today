function consoleTest() {
    console.log(`Test`);
}

/**
  // TODO: Here is the entire script tag from List, we need to figure out how to thin it down.

  // Used for loading animation
  document.getElementById("listPageLayout").style.display = "none";

  // Setup for socket connection
  const socket = io("<%= url %>");
  socket.on("connection");

  // Used for dynamic reload of page
  socket.on("refreshList", () => {
    location.reload();
  });

  let leave = document.getElementById("leave");
  leave.addEventListener("click", function () {
    let roomNumber = Cookies.get("roomNumber");
    sessionStorage.clear();
    socket.emit("generateList", { roomNumber: roomNumber });
    window.location.href = "/leave";
  });

  // If Tags are found, provide them a way to "remove" them.
  // For now, we'll just have a single button to clear and then reload the page.
  if (
    sessionStorage.getItem("tagSelection") ||
    sessionStorage.getItem("categorySelection") ||
    sessionStorage.getItem("priceSelection") ||
    sessionStorage.getItem("minPriceSelection") ||
    sessionStorage.getItem("maxPriceSelection")
  ) {
    let tempButton = document.createElement("button");
    tempButton.setAttribute("id", "filterClearButton");
    tempButton.innerHTML = "Clear Filters";

    tempButton.addEventListener("click", () => {
      // TODO: Ideally you'd want to just remove tagSelection or modify it based on the specific tag but for now this will work.
      sessionStorage.setItem("tagSelection", "");
      sessionStorage.setItem("categorySelection", "");
      sessionStorage.setItem("priceSelection", "");
      sessionStorage.setItem("minPriceSelection", "");
      sessionStorage.setItem("maxPriceSelection", "");
      window.location.reload();
    });

    document.querySelector("#clearAllFiltersButton").appendChild(tempButton);
  }

  // TODO: does everything need to be in sendMessage?
  // Connection used for sockets
  const sendMessage = () => {
    // Initializes data of user from cookies
    let steamID = Cookies.get("steamID");
    let username = Cookies.get("username");
    let avatar = Cookies.get("avatar");
    let roomNumber = Cookies.get("roomNumber");

    // Category selection functionality
    function filterBySelected(event) {
      const selected = event.target.value;
      sessionStorage.setItem("tagSelection", selected);
      window.location.reload();
    }

    // Genre selection functionality
    function filterBySelected2(event) {
      const selected = event.target.value;
      sessionStorage.setItem("categorySelection", selected);
      window.location.reload();
    }

    // Price range selection functionality
    function displayPriceRange() {
      const userInputMin = document.getElementById("inputPrice").value;
      const userInputMax = document.getElementById("inputPriceMax").value;
      // console.log("MIN INPUT:" + userInputMin);
      // console.log("MAX INPUT: " + userInputMax);

      sessionStorage.setItem("minPriceSelection", userInputMin);
      sessionStorage.setItem("maxPriceSelection", userInputMax);
      window.location.reload();
    }

    // Triggers the generation of lists on
    socket.emit("generate", {
      steamID: steamID,
      username: username,
      avatar: avatar,
      roomNumber: roomNumber,
      tagSelection: sessionStorage.getItem("tagSelection"),
      categorySelection: sessionStorage.getItem("categorySelection"),
      priceSelection: sessionStorage.getItem("priceSelection"),
      minPriceSelection: sessionStorage.getItem("minPriceSelection"),
      maxPriceSelection: sessionStorage.getItem("maxPriceSelection"),
    });

    // Receives data then displays a list of games
    socket.on("finalList", (data) => {
      // Initializes data used for the list
      const roomMembers = data.roomMembers;
      const sharedGameNames = data.games;
      const ownedByWho = data.owners;
      const gameLinks = data.links;
      const gameImages = data.images;
      const gameTags = data.tags;
      const gamePrices = data.prices;
      const categories = data.categories;
      const categoryArray = categories.map((str) =>
        str.replace(/['"] + /g, "")
      );
      // console.log("ROOM MEMBERS" + roomMembers.length);
      //   console.log(roomMembers);

      // Gets all the users and displays them together
      const roomMembersToAppend = document.querySelector("#roomMembersList");
      for (let i = 0; i < roomMembers.length; i++) {
        const userAvatar = document.createElement("img");
        userAvatar.src = roomMembers[i][2];
        userAvatar.alt = `Icon for ${roomMembers[i][1]}`;
        roomMembersToAppend.appendChild(userAvatar);
      }

      // console.log(roomMembers.length);
      // Quickly set our room number to the page.
      let currentRoomNum = document.getElementById("displayRoomNum");
      currentRoomNum.textContent = roomNumber;
      document.getElementById("animationContainer").style.display = "none";
      document.getElementById("listPageLayout").style.display = "flex";

      // Creates dropdown menu for the categories
      function dropDownMenu1() {
        const menu = document.createElement("select");
        const title = document.createElement("option");
        title.disabled = true;
        title.selected = true;
        title.textContent = "Select a Category";
        menu.appendChild(title);

        for (let i = 0; i < categoryArray.length; i++) {
          const option = document.createElement("option");
          option.value = categoryArray[i];
          option.setAttribute("name", "option");
          option.textContent = categoryArray[i];
          menu.appendChild(option);
        }

        let menuDiv = document.getElementById("menuDiv");
        menuDiv.appendChild(menu);

        menu.addEventListener("change", filterBySelected);
      }

      dropDownMenu1();
      let catDiv = document.getElementById("tagPopupButton");
      let tagString = sessionStorage.getItem("tagSelection");
      catDiv.appendChild(document.createTextNode(tagString));
      const button = document.getElementById("button");

      if (tagString === "") {
        button.style.display = "none";
      } else {
        button.textContent = catDiv.textContent + "  \u00D7";
      }

      button.addEventListener("click", () => {
        sessionStorage.setItem("tagSelection", "");
        window.location.reload();
      });

      // Creates a dropdown menu for the genres
      function dropDownMenu2() {
        const menu = document.createElement("select");
        const title = document.createElement("option");
        const genreArray = [
          "Co-op",
          "Online Co-op",
          "PvP",
          "Online PvP",
          "Cross-Platform Multiplayer",
          "Remote Play Together",
          "Shared/Split Screen Co-op",
          "Shared/Split Screen PvP",
          "LAN PvP",
          "LAN Co-op",
        ];
        title.disabled = true;
        title.selected = true;
        title.textContent = "Select a Genre";
        menu.appendChild(title);

        for (let i = 0; i < genreArray.length; i++) {
          const option = document.createElement("option");
          option.value = genreArray[i];
          option.setAttribute("name", "option");
          option.textContent = genreArray[i];
          menu.appendChild(option);
        }

        let menuDiv = document.getElementById("genreDiv");
        genreDiv.appendChild(menu);

        menu.addEventListener("change", filterBySelected2);
      }

      dropDownMenu2();

      let catDiv2 = document.getElementById("categoryPopupButton");
      let tagString2 = sessionStorage.getItem("categorySelection");
      catDiv2.appendChild(document.createTextNode(tagString2));

      const button2 = document.getElementById("button2");

      if (tagString2 === "") {
        button2.style.display = "none";
      } else {
        button2.textContent = catDiv2.textContent + "  \u00D7";
      }

      button2.addEventListener("click", () => {
        sessionStorage.setItem("categorySelection", "");
        window.location.reload();
      });

      // EVENT LISTENERS FOR PRICE FILTERS
      const freeButton = document.getElementById("freeBtn");
      freeButton.addEventListener("click", () => {
        sessionStorage.setItem("priceSelection", freeButton.textContent);
        window.location.reload();
      });

      // Used for prices under $10
      const underTen = document.getElementById("underTen");
      underTen.addEventListener("click", () => {
        sessionStorage.setItem("priceSelection", underTen.textContent);
        window.location.reload();
      });

      // Used for prices under $40
      const underFourty = document.getElementById("underFourty");
      underFourty.addEventListener("click", () => {
        sessionStorage.setItem("priceSelection", underFourty.textContent);
        window.location.reload();
      });

      // Depending on our selected price we'll change the button styling to a different color.

      // TODO: Dollar signs on text fields.
      // Used to gather a price range inputted by the user
      const priceRange = document.getElementById("displayPriceRange");
      priceRange.addEventListener("click", () => {
        let userInputMin = document.getElementById("inputPrice").value;
        let userInputMax = document.getElementById("inputPriceMax").value;

        userInputMin = parseInt(userInputMin);
        userInputMax = parseFloat(userInputMax);

        console.log(typeof userInputMax + "MAX CHECK");

        if (
          userInputMin > userInputMax ||
          userInputMin === "" ||
          userInputMax === "" ||
          userInputMin < 0 ||
          userInputMax < 0 ||
          isNaN(userInputMax) ||
          isNaN(userInputMin)
        ) {
          jSuites.notification({
            name: "INVALID RANGE",
          });
        } else {
          sessionStorage.setItem("minPriceSelection", userInputMin);
          sessionStorage.setItem("maxPriceSelection", userInputMax);
          window.location.reload();
        }
      });

      if (sessionStorage.getItem("priceSelection") == "FREE") {
        freeButton.style.color = "#B3EE11";
        freeButton.style.borderColor = "#B3EE11";
      } else if (sessionStorage.getItem("priceSelection") == "Under $10") {
        underTen.style.color = "#B3EE11";
        underTen.style.borderColor = "#B3EE11";
      } else if (sessionStorage.getItem("priceSelection") == "Under $40") {
        underFourty.style.color = "#B3EE11";
        underFourty.style.borderColor = "#B3EE11";
      } else {
        freeButton.style.color = "#FFFFFF";
        freeButton.style.borderColor = "#FFFFFF";
        underTen.style.color = "#FFFFFF";
        underTen.style.borderColor = "#FFFFFF";
        underFourty.style.color = "#FFFFFF";
        underFourty.style.borderColor = "#FFFFFF";
      }

      // Display tag of user's input for price range
      let priceDiv = document.getElementById("pricePopupButton");
      let priceString1 = sessionStorage.getItem("minPriceSelection");
      let priceString2 = sessionStorage.getItem("maxPriceSelection");

      const button3 = document.getElementById("button3");

      if (priceString1 === "" || priceString2 === "") {
        button3.style.display = "none";
      } else {
        button3.textContent =
          "$" + priceString1 + " - $" + priceString2 + " \u00D7";
      }

      // Reloads page with the price range inputed
      button3.addEventListener("click", () => {
        sessionStorage.setItem("minPriceSelection", "");
        sessionStorage.setItem("maxPriceSelection", "");
        window.location.reload();
      });

      //TODO: add comment
      function invertOwners(someArr) {
        let temp = [];
        for (let i = 0; i < roomMembers.length; i++) {
          temp.push(i);
        }
        return filterOut(temp, someArr);
      }

      //TODO: add comment
      function convertToUser(someArr) {
        let temp = ``;
        for (let i = 0; i < someArr.length; i++) {
          temp += `<img class="userIconInList" src="${
            roomMembers[someArr[i]][2]
          }" alt="Icon for ${roomMembers[someArr[i]][1]}">`;
        }
        return temp;
      }

      //TODO: add comment
      function filterOut(arr1, arr2) {
        return (arr1.filter((x) => arr2.indexOf(x) == -1));
      }

      // Adds first two tags next to the game
      function buildTags(tagsStringForm) {
        if (tagsStringForm != "") {
          let temp = tagsStringForm.split(",");
          let toReturn = ``;
          for (let i = 0; i < 2; i++) {
            toReturn += `<p class="gameTag"> ${temp[i]} </p>`;
          }
          return toReturn;
        } else {
          return "";
        }
      }

      // Adds prices next to the game
      function buildPrices(gamesPrices) {
        let toReturn = ``;
        if (gamesPrices[1] == null) {
          if (gamesPrices[0] == 0) {
            toReturn += `<p class="normalPrice"> Free </p>`;
          } else {
            toReturn += `<p class="normalPrice"> $${gamesPrices[0]} </p>`;
          }
        } else {
          if (gamesPrices[0] == 0) {
            toReturn += `<p class="normalPrice"> Free </p>`;
            toReturn += `<p class="fullPrice"> Free </p>`;
          } else {
            toReturn += `<p class="normalPrice"> $${gamesPrices[0]} </p>`;
            toReturn += `<p class="fullPrice"> $${gamesPrices[1]} </p>`;
          }
        }
        return toReturn;
      }

      // Divs used to house the generated games
      let suggestDiv = document.getElementById("toGrab");
      let recommendDiv = document.querySelector("#recGames");

      // This IF is a workaround to ensure we don't get DUPLICATE games in our list.
      if (
        suggestDiv.childNodes.length === 0 &&
        recommendDiv.childNodes.length === 0
      ) {
        for (let i = 0; i < sharedGameNames.length; i++) {
          // IF the game is NOT owned by everyone, do the top case.

          let tempTag = buildTags(gameTags[i]);
          let tempPrice = buildPrices(gamePrices[i]);
          if (ownedByWho[i].length != roomMembers.length) {
            let users = convertToUser(invertOwners(ownedByWho[i]));
            // TODO: Use actual JS methods to build these items instead of hard coding strings
            recommendDiv.innerHTML += `
                <div class="gameItem">
                    <img class="gameImage" src="${gameImages[i]}" alt="Icon for ${sharedGameNames[i]}">
                    <div class="seperator">
                        <a class="gameTitle" href="${gameLinks[i]}" target = "_blank"> ${sharedGameNames[i]}</a>
                        <div class="tagHolder">
                            ${tempTag}
                            ${tempPrice}
                        </div>
                    </div>
                    <div class="roomMembers">
                        <p class="gameMemberText"> NOT OWNED BY </>
                        <div class="roomMemberImages">
                            ${users}    
                        </div>
                    </div>
                </div>
            `;
          } else {
            // Case for EVERYONE in the room owns the game
            // TODO: Currently this code applies to ALL devices, later we want to make sure this ONLY appears for Mobile (or at least can only be triggered on mobile).
            suggestDiv.innerHTML += `
            <div id="mobileModalWrapper${i}">
                <div class="gameItem">
                    <img class="gameImage" src="${gameImages[i]}" alt="Icon for ${sharedGameNames[i]}">
                    <div class="seperator">
                        <a class="gameTitle" href="${gameLinks[i]}" target = "_blank"> ${sharedGameNames[i]} </a>
                        <div class="tagHolder">
                            ${tempTag}
                            ${tempPrice}
                        </div>
                    </div>
                </div>
            </div>
            <div id="${sharedGameNames[i]}Modal" class="modal">
                    <div class="modal-content">
                        <p> ${sharedGameNames[i]} </p>
                        <span class="back"> &times; </span>
                    </div>
            </div>
                `;
          }
          // After the IF statement, we'll make a modal for the game card.
          // TODO: See above todo, this currently is created for all devices.
          let modalTrigger = document.getElementById(`mobileModalWrapper${i}`);
          let modal = document.getElementById(`${sharedGameNames[i]}Modal`);
          modalTrigger.addEventListener("click", function () {
            modal.style.display = "flex";
          });
          //
          // let otherModalTrigger = document.getElementById(`otherMobileModalWrapper${i}`);
          // let otherModal = document.getElementById(`other${sharedGameNames[i]}Modal`);
          // otherModalTrigger.addEventListener('click', function(){
          //     modal.style.display = "flex";
          // });
        }
      }
    });
  };

  function copyFunction() {
    let copyRoomNum = document.getElementById("displayRoomNum");
    let selection = window.getSelection();
    let range = document.createRange();

    range.selectNodeContents(copyRoomNum);
    selection.removeAllRanges();
    selection.addRange(range);

    document.execCommand("copy");
  }

  // Shows that the room code has been copied
  function showSuccess() {
    jSuites.notification({
      name: "Copied to Clipboard",
    });
  }

 */