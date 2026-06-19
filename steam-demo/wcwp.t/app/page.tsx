import Image from "next/image";
import '../styles/_app.scss'

export default function Home() {
  return (
        <div>
            <div>
                <Image src="/Images/MainTitleLogo.png" alt="Main Logo" width="400" height="600"/>
                {/* <img id="logoHome" alt="What Can We Play Today Logo" src="/img/StandardImgLogo.png"/> */}
                <br></br>
                <p> What Can We Play Today is a tool for finding shared games amongst Steam Gamers. If you're a Steam gamer yourself, you can use the Steam login button below to directly login with your Steam account OR use the Alternate Login if you know your Steam ID already. 
                </p>
                <p> Feel free to try the demo below to see how it all works! </p>
                <p>By using our site, you acknowledge that you have read and understand our <a href="/privacy-policy">PRIVACY POLICY</a></p>
                <br></br>
            </div>
        <div>
            <button id = "loginModal">STEAM LOGIN</button>
                <p> OR </p>
                <button>ALTERNATE LOGIN</button>
                <button> DEMO </button>
                <div>
                    <div>
                            <div>
                                <div>
                                    <span> &times; </span>
                                    <h2> Disclaimer: Privacy Settings for Steam Users </h2>
                                </div>

                        <p>In order for "What Can We Play Today" to function properly, your Steam profile and game details need to be set to public. Here's how you can change these settings:</p>
            
                        <ol>
                            <li><strong>Access the Dropdown Menu</strong>: Click on your username in the upper right-hand corner of the Steam interface to display the dropdown menu.</li>
                            <li><strong>View Profile</strong>: From the dropdown menu, select "View Profile".</li>
                            <li><strong>Edit Profile</strong>: On your profile page, select "Edit Profile".</li>
                            <li><strong>Privacy Settings</strong>: In the Edit Profile interface, navigate to the panel on the left-hand side and select "Privacy Settings".</li>
                            <li><strong>Set to Public</strong>: In the Privacy Settings, ensure that your profile status and game details are set to "Public".</li>
                        </ol>
            
                        <p>Please refer to the video below if additional guidance is needed. </p>
            
                        <div>
                        <video width = "480" height = "240" controls>
                            <source src = "/img/privSettings.mp4" type = "video/mp4"></source>
                        </video>
                        </div>

                        <br></br>
                        <span id = "close"> I UNDERSTAND </span>
                    </div>
                    </div>
                </div>

                <div>
                    <div>
                        <div>
                        <span id = "back2"> &times; </span>
                        <h2>Disclaimer: Privacy Settings for Steam Users</h2>

                        <p>In order for "What Can We Play Today" to function properly, your Steam profile and game details need to be set to public. Here's how you can change these settings:</p>
            
                        <ol>
                            <li><strong>Access the Dropdown Menu</strong>: Click on your username in the upper right-hand corner of the Steam interface to display the dropdown menu.</li>
                            <li><strong>View Profile</strong>: From the dropdown menu, select "View Profile".</li>
                            <li><strong>Edit Profile</strong>: On your profile page, select "Edit Profile".</li>
                            <li><strong>Privacy Settings</strong>: In the Edit Profile interface, navigate to the panel on the left-hand side and select "Privacy Settings".</li>
                            <li><strong>Set to Public</strong>: In the Privacy Settings, ensure that your profile status and game details are set to "Public".</li>
                        </ol>
            
                        <p>Please refer to the video below if additional guidance is needed.</p>
            
                        
                        <div>
                        <video width = "480" height = "240" controls>
                            <source src = "/img/privSettings.mp4" type = "video/mp4"></source>
                        </video>
                        <br></br>
                        </div>
                        <span id = "close2"> I UNDERSTAND </span>
                    </div>
                    </div>
                </div>
        </div>
    </div>
  );
}
